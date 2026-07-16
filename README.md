# FrogsAtWorkHR

> A lightweight, compliance-credible **HRIS** (Human Resources Information System) for managing
> employee records across an organization. _Let's jump into it._

<!-- Fill these in when the repo is created / deployed:
[![CI](https://github.com/<you>/frogsatwork-hr/actions/workflows/ci.yml/badge.svg)](https://github.com/<you>/frogsatwork-hr/actions/workflows/ci.yml)
**Live demo:** https://… · **Case study / walkthrough:** …
-->

FrogsAtWorkHR is a portfolio project built to demonstrate full-stack engineering judgment, not just
CRUD mechanics. The domain decisions reflect how HR data actually behaves in the real world —
records are **never hard-deleted**, changes are **effective-dated**, and sensitive data like
compensation is guarded **on the server**, not just hidden in the UI.

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

## Features

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

## Tech stack

**Next.js 16** (App Router, Server Actions) · **React 19** · **Prisma 7 + PostgreSQL 16** ·
**Auth.js v5** (credentials + JWT, bcrypt) · **Tailwind CSS v4** · **TypeScript 5** ·
**Turborepo + pnpm** workspaces · **Vitest** · **nodemailer + Mailpit** · **lucide-react**.

## Monorepo layout

```
apps/
  employee-records/     Next.js app (UI, routes, server actions)
packages/
  database/             Prisma schema, migrations, seed, two-role client (@hris/database)
  auth/                 Auth.js config, RBAC predicates, RLS helpers, session (@hris/auth)
  types/                Shared Zod schemas + inferred TypeScript types (@hris/types)
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

# 5. Run the app  →  http://localhost:3000
cd apps/employee-records && pnpm dev
```

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

(`priya.nair@` and `tom.becker@frogsatwork.test` are additional Employees.)

## Testing

```bash
pnpm test           # unit + integration (103 tests)
```

Unit tests cover the pure logic (RBAC predicates, formatters, validation). Integration tests run
against a real Postgres (`hris_test`), which the harness bootstraps automatically — they exercise
RLS scoping, the compensation guard, and the write paths end-to-end.

## Environment & secrets

- Real secrets live in **`.env`** (and `.env.local`), which are **git-ignored** — nothing sensitive
  is committed. `AUTH_SECRET` is the only value you must generate yourself.
- **`.env.test`** _is_ committed on purpose: it holds only `localhost` credentials for a throwaway
  test database, so CI works with no extra setup.
- The app reads all secrets from `process.env` — none are hardcoded.

## Status & roadmap

The employee-records app is feature-complete. **Next:** production deployment (Vercel + hosted
Postgres) and a lightweight ATS ("hire" flow) that plugs into the existing employee-creation path.

---

_Built as a portfolio project. The HR-domain decisions come from real org-wide HR administration
experience — they're the point, not an afterthought._
