# Deployment Runbook — FrogsAtWorkHR

Target: **Next.js app on Vercel** + **Postgres on Neon**, preserving the two-role security model
(owner for migrations, restricted `hris_app` at runtime). Public **demo** deployment — invite
emails are intentionally disabled (see *Email*).

Legend: 🛠️ = code/config change (in-repo, done before deploying) · 👤 = you (accounts/dashboards).

---

## Architecture on hosted infra

| Concern | Local (docker) | Hosted |
| --- | --- | --- |
| Owner role (migrations, GRANT/REVOKE, RLS) | `postgres` via `DIRECT_URL` | Neon owner role via `DIRECT_URL` (direct endpoint) |
| Restricted runtime role | `hris_app` via `DATABASE_URL` | `hris_app` via `DATABASE_URL` (**pooled** endpoint) |
| Role creation | `docker/init/01-app-role.sql` | one-time SQL in Neon (Part B) |
| Schema + RLS + grants | `prisma migrate deploy` | same, run once against Neon (Part C) |

**Why pooled vs direct:** Vercel runs the app as serverless functions; each instance opens its own
`pg` pool (`client.js`). Pointing `DATABASE_URL` at Neon's **pooled** endpoint (PgBouncer) keeps us
under connection limits. Migrations need a real session, so `DIRECT_URL` uses the **direct** endpoint.

---

## Part A — 🛠️ Code/config prep (before any deploy)

1. **Run `prisma generate` before the build.** The generated client is gitignored, so a fresh Vercel
   clone has none, and `next build` would fail. Add a `prebuild` step to `apps/employee-records/package.json`:
   ```jsonc
   "prebuild": "pnpm --filter @hris/database exec prisma generate",
   "build": "next build",
   ```
   `pnpm build` runs `prebuild` automatically. (Needs `DIRECT_URL` in the env at build time — Vercel
   env provides it, same reason the CI job sets it.)
2. **Prod role-setup SQL** — commit `docs/deploy/neon-app-role.sql` (the hosted equivalent of
   `docker/init/01-app-role.sql`): `CREATE ROLE hris_app LOGIN PASSWORD '…'` + `GRANT CONNECT`/`USAGE`.
   You'll paste it into Neon's SQL editor in Part B (with a real password).
3. **(Optional) `vercel.json`** — likely unnecessary; Vercel's dashboard "Root Directory" setting
   (Part D) handles the monorepo. Add one only if the dashboard proves insufficient.

> Verify Part A locally: `pnpm --filter employee-records build` succeeds (it'll generate then build).

---

## Part B — 👤 Neon setup

1. Create a Neon project (choose a region near your users). Note the **owner** connection string.
2. In the **SQL editor**, run the contents of `docs/deploy/neon-app-role.sql` (set a strong
   `hris_app` password). This creates the restricted runtime role + base grants; the table-level
   grants/RLS come from the migrations in Part C.
3. Collect two connection strings:
   - **`DIRECT_URL`** = owner @ **direct** host, e.g. `postgresql://<owner>:<pw>@<project>.neon.tech/<db>?sslmode=require`
   - **`DATABASE_URL`** = `hris_app` @ **pooled** host, e.g. `postgresql://hris_app:<pw>@<project>-pooler.neon.tech/<db>?sslmode=require`
   (Neon shows both the direct and `-pooler` hostnames.)

---

## Part C — 👤 Migrate + seed Neon (one-time, from your machine)

Use a temporary env pointing at Neon (do **not** commit it):
```bash
DIRECT_URL='<owner direct url>' DATABASE_URL='<hris_app pooled url>' \
  pnpm --filter @hris/database exec prisma migrate deploy      # schema + RLS + grants (as owner)

DIRECT_URL='<owner direct url>' DATABASE_URL='<hris_app pooled url>' \
  pnpm --filter @hris/database db:seed                          # demo data + logins
```
Sanity check (optional): connect as `hris_app` and confirm you can `SELECT` employees but **cannot**
`UPDATE`/`DELETE` the audit log — proof RLS + the append-only grant landed.

---

## Part D — 👤 Vercel setup

1. Import `github.com/Ink710/frogsatwork-hr` into Vercel.
2. **Root Directory** = `apps/employee-records`. Framework auto-detects **Next.js**; package manager
   auto-detects **pnpm** (from `pnpm-workspace.yaml`).
3. **Environment Variables** (Production):
   | Var | Value |
   | --- | --- |
   | `DATABASE_URL` | `hris_app` **pooled** Neon URL |
   | `DIRECT_URL` | owner **direct** Neon URL |
   | `AUTH_SECRET` | **new** prod secret — `openssl rand -base64 32` (do NOT reuse dev) |
   | `APP_BASE_URL` | your Vercel URL (set after first deploy, then redeploy) |
   *(No `SMTP_*` — invites are disabled for the demo.)*
4. Deploy. Build order: `pnpm install` → `pnpm build` (→ `prebuild` generates the Prisma client →
   `next build`).
5. Once you have the assigned domain, set `APP_BASE_URL` to it and redeploy.

---

## Part E — 👤/🛠️ Post-deploy verification

- Load the site; log in as `ana.okafor@frogsatwork.test` / `password123`.
- Spot-check RBAC by logging in as each role: HR sees all; `marcus.lee@` (Manager) sees only reports;
  `diego.santos@` (Employee) sees only self; compensation hidden outside authority.
- Confirm no `too many connections` errors under a few refreshes (pooling working).
- Update the README's live-demo link with the URL.

---

## Part F — 🛠️/👤 Second app: Time & Attendance (`apps/time-management`)

The second app is a **separate Vercel project pointed at the same Neon database** as employee-records.
It shares the schema, the `hris_app` role, auth, and the seed. Because both apps share one DB, this is
mostly account wiring — the only DB action is bringing Neon's schema up to date.

### F1 — 👤 Bring the shared Neon DB up to date (one-time)

Neon was last migrated when only employee-records existed; the time-domain tables (leave, timesheets,
shifts, attendance, projects, meetings) don't exist there yet. These migrations are **additive**, so
they're safe for the already-live employee-records app.

```bash
DIRECT_URL='<owner direct url>' DATABASE_URL='<hris_app pooled url>' \
  pnpm --filter @hris/database exec prisma migrate deploy      # applies the new migrations

# Reseed (chosen): one unified demo dataset for both apps — shifts, leave balances, meetings, punches.
# This resets any reviewer-created drift on the live employee-records demo (accepted).
DIRECT_URL='<owner direct url>' DATABASE_URL='<hris_app pooled url>' \
  pnpm --filter @hris/database db:seed
```

### F2 — 👤 Upstash Redis (login rate limiting)

1. Create a free Upstash Redis database (any region).
2. Copy its **REST URL** and **REST token** (the HTTP API, not the `redis://` string).
   These become `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` below. If you skip this,
   rate limiting is simply disabled (the code is env-gated) — nothing breaks.

### F3 — 👤 Vercel project

1. Import the **same** `github.com/Ink710/frogsatwork-hr` repo as a **new** Vercel project.
2. **Root Directory** = `apps/time-management`. Framework auto-detects Next.js; pnpm auto-detects.
3. **Environment Variables** (Production):
   | Var | Value |
   | --- | --- |
   | `DATABASE_URL` | `hris_app` **pooled** Neon URL (same as employee-records) |
   | `DIRECT_URL` | owner **direct** Neon URL (same) |
   | `AUTH_SECRET` | a prod secret (can reuse employee-records' — sessions are per-domain either way) |
   | `CRON_SECRET` | `openssl rand -base64 32` — **name it exactly this**: Vercel Cron auto-sends `Authorization: Bearer $CRON_SECRET`, which `/api/cron/accrue` checks |
   | `UPSTASH_REDIS_REST_URL` | from Upstash (F2) |
   | `UPSTASH_REDIS_REST_TOKEN` | from Upstash (F2) |
   *(No `SMTP_*`; `APP_BASE_URL` optional.)*
4. Deploy. `prebuild` generates the Prisma client, then `next build` (all routes are dynamic).

### F4 — Vercel Cron (already in repo)

`apps/time-management/vercel.json` declares a monthly cron hitting `/api/cron/accrue`
(`0 6 1 * *`). Vercel picks it up automatically once `CRON_SECRET` is set.

> **Hobby-tier note:** Vercel Hobby effectively fires crons at ~daily granularity and doesn't
> guarantee the exact minute. That's fine here: accrual is **idempotent** (unique
> `[employeeId, type, accrualPeriod]` + `skipDuplicates`), so any extra trigger within the same month
> creates nothing. You can also run it on demand via the HR-only **"Run accrual"** button.

### F5 — 👤 Verify

- Log in at the new URL as `ana.okafor@frogsatwork.test`; confirm the time dashboard, schedule, and
  attendance render with seeded data.
- **Rate limiting:** submit ~6 rapid bad logins → the 6th shows *"Too many attempts…"*. (Only
  observable once Upstash env is set.)
- After the first monthly cron (or a manual "Run accrual"), confirm PTO balances accrued.
- Fill in the README's Time & Attendance live-demo link.

---

## Decisions & open items

- **Email: disabled.** No `SMTP_*`; the invite send is best-effort so nothing breaks, and seeded
  logins are pre-activated. Demo the invite → set-password flow in the **Loom** via local Mailpit.
- **Demo data mutation.** Reviewers log in as HR and *can* edit the seeded data. For now: **accept
  drift**. If it gets messy, add a scheduled reseed (Vercel Cron hitting a protected reseed route, or
  a nightly job running `db:seed`) — deferred, not built.
- **Neon free-tier autosuspend** adds a cold-start delay on the first hit after idle — acceptable for
  a demo; mention it in the Loom if noticeable.
- **`next build` and the DB.** The app's routes are dynamic (cookies/auth), so the build shouldn't try
  to prerender against the DB. If a build ever fails trying to reach Postgres, mark the offending
  route `export const dynamic = "force-dynamic"`.

---

## Rollback / ops notes

- Migrations are forward-only (`migrate deploy`); Neon offers branching + point-in-time restore.
- Rotating `AUTH_SECRET` invalidates all existing sessions.
- Secrets live only in Vercel's env + your local shell — never committed.
