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

## Part G — 🛠️/👤 Third app: ATS / Recruiting (`apps/ats`)

Same shape as Part F — a separate Vercel project on the shared Neon DB — **plus the first piece of
real object storage in the suite**, because the ATS accepts résumé uploads from the public careers
page and the `local` driver cannot work on Vercel.

### G1 — 👤 Push first

Vercel builds from GitHub. Commit and push the ATS milestones before anything below; a Vercel project
pointed at an un-pushed branch will build the wrong tree.

### G2 — 👤 Bring the shared Neon DB up to date

Neon has never seen the recruiting schema — roughly a dozen migrations from `..._add_recruiting`
through `..._candidate_leads`. They're additive to the two live apps.

```bash
DIRECT_URL='<owner direct url>' DATABASE_URL='<hris_app pooled url>' \
  pnpm --filter @hris/database exec prisma migrate deploy

# Reseed: one unified demo dataset across all three apps. This also resets any drift reviewers
# created on the live employee-records / time-management demos (chosen, same as Part F).
DIRECT_URL='<owner direct url>' DATABASE_URL='<hris_app pooled url>' \
  pnpm --filter @hris/database db:seed
```

⚠️ **Most likely failure point:** the search-index migration runs `CREATE EXTENSION IF NOT EXISTS
pg_trgm`. Neon supports it, but it needs the owner role — which is why `DIRECT_URL` must be the
**owner** connection, not `hris_app`.

### G3 — 👤 Create a **PRIVATE** Vercel Blob store

Dashboard → **Storage** → **Blob** → set access to **Private**. Or:

```bash
vercel blob create-store frogsatwork-files --access private
```

Then **connect the store to BOTH** the `ats` project and the `employee-records` project
(store → **Projects** → *Connect to Project*).

> ⚠️ **Private is not optional and cannot be changed later.** A public store hands every résumé a URL
> that anyone holding it can fetch forever, which would walk straight past the download route's
> authorization (session → short-lived signature bound to candidate *and* user → RLS). Private stores
> require auth on every read and are delivered through our own route handler, keeping those checks on
> the only path to the file. The access mode is fixed at creation, so getting it wrong means creating
> a new store.

**No token env var is needed.** Connecting the store injects OIDC credentials (`BLOB_STORE_ID` and a
short-lived, auto-rotating `VERCEL_OIDC_TOKEN`) which `@vercel/blob` picks up on its own — no
long-lived secret in the project. `BLOB_READ_WRITE_TOKEN` is only for code running outside Vercel.

### G4 — 👤 Vercel project

1. Import the **same** repo as a **new** project.
2. **Root Directory** = `apps/ats`.
3. **Environment Variables** (Production):
   | Var | Value |
   | --- | --- |
   | `DATABASE_URL` | `hris_app` **pooled** Neon URL (same as the other two apps) |
   | `DIRECT_URL` | owner **direct** Neon URL (same) |
   | `AUTH_SECRET` | a prod secret (may reuse the others' — sessions are per-domain) |
   | `CRON_SECRET` | `openssl rand -base64 32` — **exact name required**: Vercel Cron sends it as `Authorization: Bearer`, and `/api/cron/archive-stale` **fails closed** without it |
   | `STORAGE_DRIVER` | `vercel-blob` |
   | `UPSTASH_REDIS_REST_URL` / `_TOKEN` | optional; the limiters are env-gated no-ops without them |
4. Deploy. `prebuild` generates the Prisma client, then `next build`; every route is dynamic.

### G5 — 👤 Switch employee-records to Blob too

Its document upload has the same problem and has never worked in production. Add
`STORAGE_DRIVER=vercel-blob` to that project's env and redeploy. No code change — the app's runtime
"storage directory" setting simply stops applying, and `/settings` says so.

### G6 — Vercel Cron (already in repo)

`apps/ats/vercel.json` declares a weekly cron on `/api/cron/archive-stale` (`0 5 * * 1`) for the
candidate retention sweep. Picked up automatically once `CRON_SECRET` is set. The sweep is safe to
re-run: it only archives candidates already past the retention window, and archiving is idempotent
and reversible.

### G7 — 👤/🛠️ Verify

- Sign in as `raj.patel@frogsatwork.test` — pipeline board, candidates, reports and leads render.
- **The storage loop, which is the whole point of G3:** apply on `/careers/<job>` with a real PDF →
  sign in → download it from the candidate profile → the bytes match.
- **The privacy property:** fetching the blob's own `…private.blob.vercel-storage.com/…` URL without
  auth returns 401/403 — the file is reachable only through the signed route.
- Erase that candidate on `/compliance` → the download 404s and the blob is deleted.
- employee-records: upload and download an employee document on the live demo.
- `curl` `/api/cron/archive-stale` with no `Authorization` → **401**.
- Fill in the README's ATS live-demo link.

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
