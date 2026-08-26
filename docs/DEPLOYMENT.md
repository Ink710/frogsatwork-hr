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
3. Collect two connection strings, and **change Neon's default `sslmode=require` to
   `sslmode=verify-full`** (see the warning below):
   - **`DIRECT_URL`** = owner @ **direct** host, e.g. `postgresql://<owner>:<pw>@<project>.neon.tech/<db>?sslmode=verify-full`
   - **`DATABASE_URL`** = `hris_app` @ **pooled** host, e.g. `postgresql://hris_app:<pw>@<project>-pooler.neon.tech/<db>?sslmode=verify-full`
   (Neon shows both the direct and `-pooler` hostnames.)

> ⚠️ **Why not the `sslmode=require` Neon hands you.** `pg` currently treats `require` as an alias
> for `verify-full` — it encrypts *and* verifies the server certificate. In **pg v9 /
> pg-connection-string v3** that alias goes away and `require` takes libpq's weaker meaning:
> encrypt, but **don't verify the certificate**, which is open to a man-in-the-middle. Writing
> `verify-full` explicitly means a future dependency bump can't silently downgrade the connection.
> `pg` already warns about this on every run.
>
> Nothing else is needed: Neon's certificate chains to Let's Encrypt's ISRG Root X1, which is in the
> OS/Node trust store, so no `sslrootcert` path is required. Neon recommends `verify-full` too.
> (Local dev is unaffected — those URLs are plain `localhost` with no TLS.)

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
   | `AUTH_SECRET` | a **fresh** secret — `openssl rand -base64 33`. Do not reuse another project's; see the note under Part G. |
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
   | `DATABASE_URL` | `hris_app` **pooled** Neon URL (same as the other two apps), `sslmode=verify-full` |
   | `DIRECT_URL` | owner **direct** Neon URL (same), `sslmode=verify-full` |
   | `AUTH_SECRET` | a **fresh** secret — `openssl rand -base64 33`, not shared with the other projects |
   | `CRON_SECRET` | `openssl rand -base64 32` — **exact name required**: Vercel Cron sends it as `Authorization: Bearer`, and `/api/cron/archive-stale` **fails closed** without it |
   | `STORAGE_DRIVER` | `vercel-blob` |
   | `ENABLE_EXPERIMENTAL_COREPACK` | `1` — see the note below |
   | `UPSTASH_REDIS_REST_URL` / `_TOKEN` | optional; the limiters are env-gated no-ops without them |
   | `PORTAL_BASE_URL` | **the CANDIDATE PORTAL's URL** (app 4, Part I) — ⚠️ *not* this project's own. See below |
   | `RECRUITING_REPLY_TO` | an address a candidate can actually write to; set as `Reply-To` on candidate email |
4. Deploy. `prebuild` generates the Prisma client, then `next build`; every route is dynamic.

> ⚠️ **`PORTAL_BASE_URL` IS THE PORTAL'S URL, NOT THIS PROJECT'S — and it cannot be set until app 4
> exists.** The ATS sends most candidate notifications, and its own `APP_BASE_URL` points at the ATS,
> which is a staff tool behind a login. Linking an applicant there sends them to a sign-in page for
> an account they do not have and must never have.
>
> So there is an ORDER: deploy app 4 (Part I) → it gets a URL → come back, set this, and **redeploy
> the ATS**. Until then every notification links to `http://localhost:3003`, and nothing errors to
> tell you. Added in M8; this runbook did not mention it until M12.

> ⚠️ **`RECRUITING_REPLY_TO` exists because everything sends from `no-reply@`.** Interview times can
> be chosen only ONCE (M11), and the refusal tells a candidate to get in touch — which needs somewhere
> to get in touch. Deliberately an address rather than a named person: it survives someone leaving and
> publishes no personal staff address to strangers. Set it on this project **and** on app 4.

> ⚠️ **Give every project its OWN `AUTH_SECRET` and `CRON_SECRET`.** An earlier version of this
> runbook said the auth secret could be reused across projects because "sessions are per-domain
> anyway". That's true and it argues the *opposite* way: the deployed apps sit on different domains,
> so cookies never travel between them and a shared secret buys nothing in production — while making
> a single leak enough to forge sessions for all three, and turning any rotation into a three-app
> job. `CRON_SECRET` is per-project by construction: Vercel sends *that* project's value as the
> bearer token on *that* project's cron requests.
>
> The one case where sharing is right is deliberate SSO — all apps behind a single domain with a
> shared cookie domain. That's a design decision to make on purpose, not something to inherit from a
> copy-pasted value. (Locally, the apps *do* share a secret on purpose, so one login covers
> `localhost:3000/3001/3002`.)

> ⚠️ **`ENABLE_EXPERIMENTAL_COREPACK=1` — the build failure both earlier projects hit.** Without it
> Vercel installs with its own bundled (older) pnpm and the install dies with `ERR_INVALID_THIS`.
> The root `package.json`'s `"packageManager": "pnpm@11.9.0"` field is **not sufficient on its own** —
> that was learned the hard way on the first deploy. Vercel's default pnpm may have caught up since,
> so this may be unnecessary now; it is harmless either way, and it's the first thing to set if the
> install step fails.

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

## Part I — 🛠️/👤 Fourth app: Candidate portal (`apps/candidate-portal`)

Same shape as Parts F and G — a separate Vercel project on the shared Neon DB — with three
differences that matter more than the similarities, all called out below.

**This app is PUBLIC.** Unlike the other three it has no login wall in front of the whole site: job
listings, job detail and the apply form are open to strangers, and only `/portal` requires a session.
Its proxy matcher is the INVERSE of the other apps' for that reason.

### I1 — 👤 Push first

Vercel builds from GitHub. Push everything through M12 before creating the project; a project
pointed at an un-pushed branch builds the wrong tree.

### I2 — 👤 Bring the shared Neon DB up to date

Neon has seen everything through the ATS deploy. It needs the **13 migrations from
`20260824120000_application_source` through `20260828120000_applicant_self_schedule`** — the whole
applicant-portal line (M1–M11). All additive to the three live apps.

```bash
DIRECT_URL='<owner direct url>' DATABASE_URL='<hris_app pooled url>' \
  pnpm --filter @hris/database exec prisma migrate deploy

# Reseed: one unified demo dataset across all FOUR apps. Same choice as Parts F and G, and the same
# accepted cost — it resets any drift reviewers created on the three live demos.
DIRECT_URL='<owner direct url>' DATABASE_URL='<hris_app pooled url>' \
  pnpm --filter @hris/database db:seed
```

> ✅ **This step is lower-risk than it looks.** `test/globalSetup.js` runs `prisma migrate deploy`
> against a **freshly created** database on every integration test run — the same thing Neon does. All
> 49 migrations replaying cleanly from empty is continuously proven, not assumed.

⚠️ Several of these migrations `DROP` and `CREATE` functions rather than replacing them
(`app_submit_application` twice, `app_erase_candidate`, the notification claim pair). That is normal
and safe on a forward-only deploy — but it means **`prisma migrate deploy` must run to completion**.
Prisma does NOT wrap a migration in a transaction, so a half-applied file leaves objects dropped. If
one fails, see Part H's recovery notes before retrying.

### I3 — 👤 Connect the EXISTING Blob store — do **not** create one

> ⚠️⚠️ **THE MOST DAMAGING MISTAKE AVAILABLE IN THIS PART.** App 4 WRITES résumés (the apply flow and
> the profile editor) and the ATS READS them through its own download routes. They must be the same
> store.
>
> A new store would mean **every CV submitted through the front door 404s in the ATS** — and it would
> present as a permissions or signing bug, not a wiring one, because the routes, the signatures and
> RLS would all be working perfectly.

Storage → Blob → the existing **`frogsatwork-files`** store → *Connect to Project* → the new
candidate-portal project. Connecting injects OIDC credentials automatically; there is no token to
copy. **Connect before the first deploy**, as in Part G.

### I4 — 👤 Vercel project

1. Import the **same** repo as a **new** project.
2. **Root Directory** = `apps/candidate-portal`.
3. **Environment Variables** (Production):
   | Var | Value |
   | --- | --- |
   | `DATABASE_URL` | `hris_app` **pooled** Neon URL (same as the other three), `sslmode=verify-full` |
   | `DIRECT_URL` | owner **direct** Neon URL (same), `sslmode=verify-full` |
   | `CANDIDATE_AUTH_SECRET` | a **fresh** secret — `openssl rand -base64 33`. ⚠️ Different NAME from the staff apps, see below |
   | `APP_BASE_URL` | **this project's own** URL — magic-link redemption and the apply receipt both build links on it |
   | `RECRUITING_REPLY_TO` | the same address set on the ATS |
   | `STORAGE_DRIVER` | `vercel-blob` |
   | `ENABLE_EXPERIMENTAL_COREPACK` | `1` |
   | `UPSTASH_REDIS_REST_URL` / `_TOKEN` | optional; **four** limiters here (login, apply, profile, schedule), all env-gated no-ops without it |
4. Deploy.

**No `CRON_SECRET`, and no `vercel.json`** — unlike Parts F and G, this app has no cron routes. Do not
copy one across; an unused secret is a credential nobody rotates.

**No SMTP variables.** Production has no mail provider by design (see Part G's decisions): every send
is attempted, fails, and is logged as `FAILED` on `NotificationDelivery`. The in-portal banner is what
carries the notification feature on the live demo, and it needs nothing configured.

> ⚠️ **The auth secret has a different NAME, not just a different value.** It is
> `CANDIDATE_AUTH_SECRET`, and the cookie is `candidate-portal.session-token`. Applicants and staff
> are deliberately disjoint realms: a live staff session must not satisfy `/portal`, and this is what
> makes that structural rather than a rule someone remembers. Setting `AUTH_SECRET` here instead
> would leave the app with no secret at all.

### I5 — 👤 Then go back and finish the ATS

⚠️ **The step whose omission produces no error anywhere.** `PORTAL_BASE_URL` lives on the **ATS**
project and points at the URL app 4 just got:

1. ATS project → Environment Variables → `PORTAL_BASE_URL` = app 4's production URL.
2. **Redeploy the ATS.**

Until this is done, every candidate notification the ATS sends links to `http://localhost:3003`.
Nothing fails; the links are simply wrong.

### I6 — 👤/🛠️ Verify

Run these and paste the results back.

```bash
# 1. Public surfaces — all 200, no session required.
curl -s -o /dev/null -w '%{http_code} %{time_total}s  /\n'            https://<portal>/
curl -s -o /dev/null -w '%{http_code} %{time_total}s  /api/health\n'  https://<portal>/api/health
curl -s -o /dev/null -w '%{http_code} %{time_total}s  /brand\n'       https://<portal>/brand/frog-dark.png

# 2. The private area redirects when signed out (307 → /sign-in), and a bogus job 404s.
curl -s -o /dev/null -w '%{http_code}  /portal (expect 307)\n'        https://<portal>/portal
curl -s -o /dev/null -w '%{http_code}  /jobs/bogus (expect 404)\n'    https://<portal>/jobs/bogus
```

| Result | Means |
| --- | --- |
| all 200, `/portal` 307, `/jobs/bogus` 404 | Working. The 307 proves the inverted proxy matcher is live |
| `/brand/*.png` 307s to `/sign-in` | The matcher is wrong — it must match ONLY `/portal/:path*` |
| `/` 200 but `/api/health` 503 and DB pages 500, **sub-second** | ⚠️ Not a cold start. Sub-second means quota, auth, or a missing DB — check the Neon usage page for the RIGHT org and project (match the host against `DATABASE_URL`) |
| `/api/health` slow then 200 | A Neon cold start. Expected and accepted — the keep-warm pinger is what exhausted the free tier on 2026-08-19 |
| build fails at install with `ERR_INVALID_THIS` | `ENABLE_EXPERIMENTAL_COREPACK=1` |

Then, in a browser: apply for a job, request a sign-in link (⚠️ **no mail provider in production**, so
redeem it from the token in the Vercel function logs rather than an inbox), and confirm `/portal`
shows the application.

⚠️ **NO NEON HEARTBEAT.** A fourth app raises the baseline again. The 5-minute keep-warm pinger is
exactly what exhausted the free tier on 2026-08-19 — 720 h/month at 0.25 CU ≈ 180 CU-hrs against a
100 CU-hr quota. Cold starts and quota are the same dial; the cold start is the accepted cost.

---

## Decisions & open items

- **Email: disabled.** No `SMTP_*`; the invite send is best-effort so nothing breaks, and seeded
  logins are pre-activated. Demo the invite → set-password flow in the **Loom** via local Mailpit.
- **Demo data mutation.** Reviewers log in as HR and *can* edit the seeded data. For now: **accept
  drift**. If it gets messy, add a scheduled reseed (Vercel Cron hitting a protected reseed route, or
  a nightly job running `db:seed`) — deferred, not built.
- **Neon free-tier autosuspend** adds a cold-start delay on the first hit after idle — acceptable for
  a demo; mention it in the Loom if noticeable. **Leave it alone.**

  > ⚠️ **DO NOT run an uptime pinger to avoid that cold start — it took all three demos offline.**
  > Neon free allows **100 CU-hrs/month**; compute runs at **0.25 CU**, so the budget is ~400 hours
  > of *active* compute. A ping every ~5 minutes stops the database ever suspending: ~720 hours of
  > activity a month, ~180 CU-hrs, quota exhausted well before month end. Every app on that database
  > then gets connections **refused in under a second** — which reads like an outage, not a limit,
  > because Vercel stays up and only DB-backed routes fail.
  >
  > Cold starts and quota are the same dial. Bursty demo traffic on the default 5-minute autosuspend
  > uses a few compute-hours a month. **Prefer the cold start.**
  >
  > Diagnosing it again: `/login` (no DB) returns **200** while `/api/health` returns **503** and
  > DB-backed pages **500** — and the failure is *sub-second*, which rules out both a cold wake
  > (seconds, then succeeds) and a network timeout (much longer). Check the Neon **usage** figures,
  > and make sure you're looking at the right Neon **org and project** — an unrelated project's tidy
  > dashboard will happily tell you nothing is wrong.
- **`next build` and the DB.** The app's routes are dynamic (cookies/auth), so the build shouldn't try
  to prerender against the DB. If a build ever fails trying to reach Postgres, mark the offending
  route `export const dynamic = "force-dynamic"`.

---

## Part H — 👤 Recovery: rebuilding on a fresh Neon project

Used 2026-08-19 after the free-tier compute quota was exhausted (see the pinger warning above). Also
the procedure for *any* "the database is gone/unusable" situation, because **the database is fully
reproducible from this repo** — migrations define the schema, RLS and grants; the seed defines the
demo data. Nothing needs to be rescued from the old project.

**The allowance is per PROJECT** (Neon Free: 100 CU-hours *per project*), so a new project in the
**same organization** gets a clean budget. No new org, and nothing to "unlink" — the Vercel projects
hold plain `DATABASE_URL` / `DIRECT_URL` env vars, not a marketplace integration.

### H1 — Create the project
Neon → same org → **New Project**. Match the old settings so nothing else shifts:
- **Region: AWS US East 1 (N. Virginia)** — Vercel routes these deployments through `iad1`; a distant
  database adds latency to every request.
- **Postgres 17**.
- **Leave Neon Auth OFF.** This suite has its own identity model (Auth.js + a `User` table + bcrypt,
  with RLS driven by the `app.current_*` session vars `withViewer` sets). Neon Auth would be a
  second, competing notion of "who is signed in" and buys nothing here.
- Note the **database name** Neon creates (usually `neondb`) — H2 needs it.

### H2 — Create the restricted role (SQL editor, as owner)
`docs/deploy/neon-app-role.sql`, with the two placeholders filled in:
```sql
CREATE ROLE hris_app WITH LOGIN PASSWORD '<a strong new password>';
GRANT CONNECT ON DATABASE neondb TO hris_app;   -- <- your db name
GRANT USAGE ON SCHEMA public TO hris_app;
```
The role name must be exactly `hris_app` — the migrations reference it by name.

### H3 — Build both connection strings
Neon shows you the **owner's** string. The app's string you assemble yourself: same host, but the
`hris_app` role and the password from H2. Both get `sslmode=verify-full` (see Part B).
- **`DIRECT_URL`** = owner @ **direct** host
- **`DATABASE_URL`** = `hris_app` @ **`-pooler`** host

⚠️ Easy to get wrong: using the owner string for both. Then RLS never bites, because the owner
bypasses every policy and REVOKE — the app would appear to work while silently having no security.

### H4 — Schema + data (from your machine)
```bash
DIRECT_URL='<new owner direct url>' DATABASE_URL='<new hris_app pooled url>' \
  pnpm --filter @hris/database exec prisma migrate deploy

DIRECT_URL='<new owner direct url>' DATABASE_URL='<new hris_app pooled url>' \
  pnpm --filter @hris/database db:seed
```
Expect ~35 migrations and a seed summary ending `salaryBands: 1, offers: 1, greatLeads: 1`.

### H5 — Repoint the three Vercel projects
Update **`DATABASE_URL`** and **`DIRECT_URL`** on `employee-records`, `time-management` and `ats` —
six edits. Raw values, no quotes, marked sensitive. Everything else (AUTH_SECRET, CRON_SECRET,
STORAGE_DRIVER, Blob connection) is unchanged.

### H6 — Redeploy all three
Env changes only reach a **new** deployment.

> Sessions survive: `AUTH_SECRET` is unchanged and the seed uses **deterministic UUIDs**, so an
> already-signed-in browser still resolves to a valid user. No forced logout.

### H7 — Verify (👤)
`/api/health` → `{"ok":true}` on all three · sign in as `ana.okafor@frogsatwork.test` · ATS
`/careers` shows the posted band on the backend req · one page from each app renders real data.

### H8 — Afterwards
- **Do not delete the old project yet.** Its quota resets at the start of the next billing period,
  making it a ready fallback. Delete it once the new one has run clean for a while.
- **Confirm no pinger is running** against `/api/health` anywhere (UptimeRobot, cron-job.org, a
  GitHub Action). A fresh allowance burns on the same clock if the heartbeat is still alive — that
  is what caused this outage, not ordinary traffic.

---

## Rollback / ops notes

- Migrations are forward-only (`migrate deploy`); Neon offers branching + point-in-time restore.
- Rotating `AUTH_SECRET` invalidates all existing sessions.
- Secrets live only in Vercel's env + your local shell — never committed.
- **Vercel env fields take RAW values — never wrap them in quotes.** `.env` files strip quotes;
  Vercel's dashboard does not, so `"https://…"` becomes a value that literally starts with `"`. The
  same goes for trailing whitespace: a stray space on `CRON_SECRET` produces a 401 that looks like a
  code bug. Paste carefully, especially the base64 secrets.
- **Upstash: use the REST pair**, not the `redis://` string — the limiter speaks Upstash's HTTP API
  (`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`).
- **All three projects' `DATABASE_URL` / `DIRECT_URL` must use `sslmode=verify-full`** (Part B). If
  one is still on Neon's default `require`, it keeps working today and silently loses certificate
  verification whenever `pg` reaches v9. Worth grepping the env vars whenever a project is added.
