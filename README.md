# FrogsAtWorkHR

[![CI](https://github.com/Ink710/frogsatwork-hr/actions/workflows/ci.yml/badge.svg)](https://github.com/Ink710/frogsatwork-hr/actions/workflows/ci.yml)

> A lightweight, compliance-credible **HRIS** suite covering employee records, time & attendance,
> and hiring across an organization. _Let's jump into it._

**▶ Live demos** — sign in with a seeded account below (password `password123`):

- **Employee Records:** https://frogsatwork-hr.vercel.app
- **Time & Attendance:** https://frogsatwork-hr-time-management.vercel.app
- **Recruiting / ATS:** https://frogsatwork-hr-ats.vercel.app

FrogsAtWorkHR is a portfolio project built to demonstrate full-stack engineering judgment, not just
CRUD mechanics. The domain decisions reflect how HR data actually behaves in the real world —
records are **never hard-deleted**, changes are **effective-dated**, and sensitive data like
compensation is guarded **on the server**, not just hidden in the UI.

It's a **three-app monorepo suite** sharing one database, auth, and design system:

| App | What it does |
| --- | --- |
| **Employee Records** | The system of record: profiles, effective-dated history, departments, the org chart. |
| **Time & Attendance** | PTO, weekly timesheets, shift scheduling, clock in/out, recurring meetings. |
| **Recruiting (ATS)** | Requisitions, a public careers page, the hiring pipeline, scorecards, salary bands and offers, EEO reporting and GDPR erasure. |

Same sign-in, same security model — and the ATS closes the loop: a hired candidate becomes an
employee in Employee Records through a single audited seam.

## Screenshots

| Employee directory (desktop) | Responsive (mobile) |
| --- | --- |
| ![HR Admin Dashboard](docs/screenshots/desktop.png) | ![Mobile view](docs/screenshots/mobile.png) |

---

## Why it's different

Most "employee CRUD" demos overwrite data and hide fields in the frontend. Real HR systems can't:

- **Never hard-delete.** Employees are soft-deleted (status + termination metadata). Records must be
  retained for compliance; a terminated employee can even be rehired, restoring their history.
- **Effective-dated records.** A change to title, salary, or department doesn't overwrite the
  current value — it closes the current version and opens a new dated one. You can view an
  employee's full timeline. (This is the signature feature.)
- **Authorization is about _data_, not screens.** Role-based visibility is enforced in the database
  and the API. A manager can only see their reports; compensation is unreadable outside a viewer's
  authority — even in raw API responses and audit diffs.

## Features — Employee Records

- **Effective-dated employee records** with a full versioned timeline (temporal history model).
- **Corrections vs. changes** — a genuine change opens a new version; a mistake can be corrected
  in place, but only within a 7-day grace window.
- **Soft-delete lifecycle** — terminate (with reason + rehire eligibility) and rehire.
- **Reversible status changes** — place on leave / suspend, then reinstate, retained as spans.
- **Role-based access control** — five roles (HR Admin, HR Generalist, Payroll Admin, Manager,
  Employee) with strict, database-enforced data scoping.
- **Compensation guard** — salary and pay data are gated by a dedicated authority check everywhere
  they could surface (profile, history, audit log).
- **Org chart** — the complete company hierarchy (recursive), visible to everyone but exposing no
  personal data of records you can't open.
- **HR dashboard** — headcount, composition, span-of-control, and department budget aggregations.
- **Append-only audit log** — every mutation recorded, with a cursor-paginated per-employee viewer
  and compensation redaction for viewers who lack authority.
- **Invite / set-password flow** — new hires are emailed a one-time invite (via Mailpit in dev).
- **Emergency contacts**, **departments + budgets**, **private document uploads** (signed URLs).
- **Internationalization** (English / Spanish, cookie-based) and **light/dark theming** (per-user,
  no flash of the wrong theme).
- **Search, filter, and pagination** on the employee list.

## Features — Time & Attendance

The second app in the suite, sharing the same users, roles, and security model — one sign-in, one
database, one set of rules:

- **Time off / PTO** — request, approve, and deny leave against a **ledger-based balance** (balance =
  sum of signed rows, auditable), with **automatic monthly accrual** (proration on hire, capped) and
  an overdraw warning.
- **Timesheets** — weekly grids with **California "greater-of" overtime** (daily > 8h vs weekly > 40h,
  non-exempt only) plus **daily double-time** (> 12h); overtime is _derived_, never stored.
- **Scheduling** — a weekly shift calendar (assigned or **open** shifts), batch shift creation,
  manager publish, and **drop/swap requests** routed through a unified approvals inbox.
- **Attendance** — clock in/out with a live "worked today" counter, derived daily status
  (on-time / late / short / absent), a **weekly team roster** with approved-leave overlay, and
  **append-only corrections** (a manual punch, never a mutated row).
- **Meetings** — weekly recurring activities that pre-fill suggested timesheet lines.
- **Time dashboard** — a role-aware snapshot (self for everyone; team oversight for managers/HR).
- **Approvals inbox** — one place for leave, timesheets, and shift swaps.
- **Timezone-correct** — instants are stored UTC and displayed in the viewer's zone (cookie-based),
  including day/week boundaries.
- **Login rate limiting** — see _Architecture highlights_.

## Features — Recruiting (ATS)

The third app, and the one that closes the loop back into Employee Records. Its access model is
deliberately **different** from the other two: not the org chart, but a **per-requisition hiring
team** (recruiter / hiring manager / interviewer), which is how hiring access actually works.

- **Requisitions** — job postings with configurable **interview rounds** and **scoring
  competencies**, a staffed hiring team, and a status lifecycle (never deleted).
- **Public careers page + apply flow** — the suite's only unauthenticated surface. Anonymous
  submissions go through a **`SECURITY DEFINER` doorway** rather than a hole in the security policy,
  with a honeypot, IP rate limiting, and résumé upload behind the storage adapter.
- **Pipeline board** — drag-and-drop stage moves with rules the server enforces: forward one step at
  a time, backward to any earlier stage, terminal states that stay terminal.
- **Scorecards with anti-anchoring** — you cannot read a colleague's feedback until you have
  submitted your own, enforced in the database. Interviewers may only *start* feedback while the
  candidate is at the interview stage — but may always finish a draft they opened.
- **Salary bands and offers** — compensation lives in its own tables so that **row-level security can
  hide it from interviewers**, since RLS cannot hide a column. Offers are versioned, with compa-ratio
  and a required written justification for going outside the band.
- **The hire seam** — a hired candidate becomes an employee through one audited `app_link_hire`
  doorway, because neither role spans the boundary: recruiters cannot create employees, and HR
  cannot write the application.
- **Compliance** — voluntary **EEO-1** self-identification in a table the app role cannot read at
  all, aggregate reporting with small-cell suppression, two separate CSV exports (suppressed vs
  exact, the exact one audited), and **GDPR erasure** that destroys the person while every reporting
  figure still balances.
- **Retention** — a weekly sweep archives long-idle candidates; a **great-leads pool** keeps the
  strong ones findable afterwards.

## Architecture highlights

These are the parts worth reading the code for:

- **Two-role database security.** Migrations and seeding connect as the Postgres **owner**
  (`DIRECT_URL`); the running app connects as a **restricted `hris_app` role** (`DATABASE_URL`) via
  the Prisma 7 `pg` driver adapter. The app can never run DDL or bypass its own guardrails.
- **Postgres Row-Level Security (RLS) + an app-layer guard.** RLS policies scope which employee
  rows a viewer can see at all, driven by per-request session variables set inside a transaction
  (`withViewer`). On top of that, a pure authorization layer decides field-level access (e.g.
  compensation). The principle: **RLS never decides authorization alone** — it's defense in depth.
- **Append-only audit, enforced in the database.** `UPDATE`/`DELETE` are revoked from `hris_app`
  on the audit table, so the application _cannot_ rewrite history even with a bug.
- **Temporal history model.** Each employee has an ordered set of `EmployeeHistory` versions with
  `effectiveFrom`/`effectiveTo`; exactly one open version at a time is an invariant enforced by the
  write paths.
- **Typed contracts.** Validation lives in Zod schemas shared across server actions and forms; the
  static TypeScript types are **derived from those schemas** (`z.infer`) so they can't drift.
- **Deliberately minimal login rate limiting.** The Time & Attendance login is throttled per client
  IP with Upstash Redis, kept at the **bare operational minimum** on purpose: a **fixed window**
  (one auto-expiring integer counter, ~one Redis command per attempt — no large payloads), analytics
  **off** (no extra keys written), an in-memory **ephemeral cache** so repeated blocked attempts on a
  warm instance never touch Redis, and **IP-only keys** (no email/PII stored). It's **env-gated** — if
  the Upstash vars are absent (local dev, tests), it's a transparent no-op and Redis is never
  contacted. See `apps/time-management/lib/rate-limit.js`.

## Tech stack

**Next.js 16** (App Router, Server Actions) · **React 19** · **Prisma 7 + PostgreSQL 16** ·
**Auth.js v5** (credentials + JWT, bcrypt) · **Tailwind CSS v4** · **TypeScript 5** ·
**Turborepo + pnpm** workspaces · **Vitest** · **nodemailer + Mailpit** · **lucide-react** ·
**Upstash Redis** (login rate limiting) · **Vercel Cron** (monthly PTO accrual).

## Monorepo layout

```
apps/
  employee-records/     Next.js app — system of record (UI, routes, server actions) · :3000
  time-management/      Next.js app — time & attendance (PTO, timesheets, scheduling, clock) · :3001
packages/
  database/             Prisma schema, migrations, seed, two-role client (@hris/database)
  auth/                 Auth.js config, RBAC predicates, RLS helpers, session (@hris/auth)
  types/                Shared Zod schemas + inferred TypeScript types (@hris/types)
  workable-hours/       Time-domain Zod schemas + pure rules (overtime, accrual, totals) (@hris/workable-hours)
  ui/, notifications/   Reserved shared-package slots for future apps
```

## Local development

**Prerequisites:** Node 24+, pnpm 11+, Docker.

```bash
# 1. Start Postgres (:5433) and Mailpit (SMTP :1025, web UI :8025).
#    On first run, the container also creates the restricted `hris_app` runtime role
#    (see docker/init/01-app-role.sql).
docker compose up -d

# 2. Install dependencies
pnpm install

# 3. Configure environment
cp .env.example .env            # then set AUTH_SECRET (see below)
#    generate one with:  openssl rand -base64 32

# 4. Apply migrations (schema, RLS policies, grants), then seed demo data
pnpm --filter @hris/database db:deploy
pnpm --filter @hris/database db:seed

# 5. Run an app
pnpm --filter employee-records dev    # Employee Records  → http://localhost:3000
pnpm --filter time-management dev      # Time & Attendance → http://localhost:3001
pnpm --filter ats dev                  # Recruiting (ATS)  → http://localhost:3002
```

All three apps share the same database and `AUTH_SECRET`, so a single sign-in works across the suite
in local dev.

Invite emails are captured by Mailpit — open the web UI at **http://localhost:8025** to view them.

### Seeded logins

All demo accounts use the password **`password123`**:

| Email                          | Role           | Sees                         |
| ------------------------------ | -------------- | ---------------------------- |
| `ana.okafor@frogsatwork.test`  | HR Admin       | everyone, all fields         |
| `bianca.ross@frogsatwork.test` | HR Generalist  | everyone, no restricted comp |
| `nadia.cole@frogsatwork.test`  | Payroll Admin  | comp across the org          |
| `marcus.lee@frogsatwork.test`  | Manager        | their reports only           |
| `diego.santos@frogsatwork.test`| Employee       | only their own record        |
| `raj.patel@frogsatwork.test`   | Recruiter      | every requisition, org-wide  |

(`priya.nair@` and `tom.becker@frogsatwork.test` are additional Employees.)

**In the ATS**, access is per-requisition rather than org-chart-based, which is worth seeing side by
side: `raj.patel@` (recruiter) manages everything; `marcus.lee@` is the hiring manager on the backend
req; `diego.santos@` and `tom.becker@` are interviewers there — they can read the pipeline and write
their own scorecard, but **never see the salary band or the offer**; and `priya.nair@` is on no
hiring team at all, so the app is empty for her.

## Testing

```bash
pnpm test           # unit + integration (617 tests: 227 unit + 390 integration)
```

Unit tests cover the pure logic (RBAC predicates, overtime/accrual rules, formatters, validation).
Integration tests run against a real Postgres (`hris_test`), which the harness bootstraps
automatically — they exercise RLS scoping, the compensation guard, the approval gates, and the write
paths end-to-end across all three apps.

## Paid services: the seam ships, the account is yours

Some capabilities need a third-party account that costs money at real volume. Rather than pretend
otherwise, the suite ships the **integration seam** fully wired and leaves the credentials to whoever
runs the app. They all degrade honestly: unconfigured, they either no-op or fail with an actionable
error — never silently, and never by appearing to work.

**Object storage** (`@hris/storage`) — one interface, `put` / `getStream` / `remove`, selected with
`STORAGE_DRIVER`:

| Driver | Status |
| --- | --- |
| `local` (default) | **Fully working.** Writes to the filesystem; used in development and tests. |
| `vercel-blob` | **Fully working.** Backed by a **private** Vercel Blob store; what the live demos run on. |
| `s3` · `r2` | **Declared, not implemented.** Throws a clear "configure this driver" error. |

The local driver is the right choice for development but **cannot** be used on serverless hosting
(Vercel's filesystem is ephemeral and read-only), so a deployed instance that accepts document or
résumé uploads needs a cloud driver. Implementing one is a single file against the existing interface —
no calling code changes.

⚠️ **The Blob store must be created as PRIVATE**, and the access mode cannot be changed afterwards. A
public store gives every file a URL that works forever for anyone who has it, which would bypass the
authorization the download routes exist to enforce (a short-lived signature bound to one record *and*
one user, on top of row-level security). Private stores authenticate every read and are delivered
through the app's own route handler, so those checks stay on the only path to the bytes.

**Rate limiting** — the minimal Upstash Redis limiter (see *Architecture highlights*). Without
`UPSTASH_REDIS_REST_URL` / `_TOKEN` every limiter is a transparent no-op and Redis is never contacted.
There are four, each with its own key prefix and budget, because they defend different things:

| Limiter | Prefix | Budget | Why |
| --- | --- | --- | --- |
| Login (time-management) | `tm:login` | 5 / 60s | Password guessing. |
| Login (ATS) | `ats:login` | 5 / 60s | Same, separately counted. |
| Careers apply | `ats:apply` | 8 / 10min | Public and unauthenticated; a real applicant may retry or apply to several roles. |
| Erasure request | `ats:erasure` | 4 / 10min | Public; the tightest, since a genuine request happens once. |

Prefixes are namespaced **per app** so the three apps can share one Upstash database without sharing
a counter — a shared prefix would mean one person's login attempts on one app throttling them on
another.

**Scheduled jobs** — not a paid service, but a deployment needs it and the failure is silent, which
makes it worth listing here. Two Vercel Crons authenticate with a shared `CRON_SECRET`
(constant-time compared, and the route **fails closed** when the variable is unset):

| Job | App | Schedule |
| --- | --- | --- |
| `/api/cron/accrue` | time-management | Monthly — PTO accrual. |
| `/api/cron/archive-stale` | ATS | Weekly — candidate retention sweep. |

Without `CRON_SECRET` these return 401 and simply never run: no error surfaces anywhere, PTO stops
accruing and the talent pool stops being tidied. Set it.

## Environment & secrets

- Real secrets live in **`.env`** (and `.env.local`), which are **git-ignored** — nothing sensitive
  is committed. `AUTH_SECRET` is the only value you must generate yourself.
- **`.env.test`** _is_ committed on purpose: it holds only `localhost` credentials for a throwaway
  test database, so CI works with no extra setup.
- The app reads all secrets from `process.env` — none are hardcoded.

## Status & roadmap

All three apps are feature-complete and **deployed** — three Vercel projects against one Neon
Postgres database, with résumés and documents in a private Vercel Blob store. Runbook in
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

**Next:** an applicant-facing register site, where candidates hold accounts, track their own
applications and self-schedule interviews — the suite's first non-employee identity.

---

_Built as a portfolio project. The HR-domain decisions come from real org-wide HR administration
experience — they're the point, not an afterthought._
