# ADR-005 — Two database roles: `postgres` migrates, `hris_app` runs

**Status:** accepted · **Date:** 2026-07 · **Applies to:** every environment

## Context

RLS only protects against roles it applies to. A table's **owner is exempt from its own policies**
unless `relforcerowsecurity` is set. If the application connected as the owner, every policy in the
suite would be decorative.

## Options

1. **One role for everything** — simple, and silently disables RLS.
2. **Owner + restricted runtime role.**
3. One role plus `FORCE ROW LEVEL SECURITY` on every table — keeps one connection string, but the
   owner then cannot run maintenance or migrations without disabling it per table.

## Decision

**Option 2.**

| Role | Used by | RLS | Notes |
|---|---|---|---|
| `postgres` (owner) | migrations, Prisma Studio, psql | **bypassed** | can do anything |
| `hris_app` (restricted) | every running app, via `DATABASE_URL` | **applies** | plus targeted `REVOKE`s — see [ADR-009](009-retention-is-a-privilege.md) |

## ⚠️ Consequences — the one that bites on a fresh database

**`hris_app` is not created by any migration.** It must exist *before* `migrate deploy`, because
**64 `GRANT ... TO hris_app` statements** depend on it. On a new Neon project, creating the role by
hand is step one; `docs/deploy/neon-app-role.sql` is the bootstrap.

Also:

- **Any psql check of a policy must `SET LOCAL ROLE hris_app` first.** Run as the owner it proves
  nothing. This produced a false cross-tenant-leak report once — the tell is every persona seeing
  the *same* count, which means RLS is off, not leaking.
- Tests run through the restricted role, which is why they catch privilege regressions at all.
- `relforcerowsecurity` stays **off** deliberately: migrations and the seed need owner access.

## Implications for the product build

Every new database — per tenant, per environment, per developer — needs this bootstrap. It is the
single most likely step to be forgotten, and its failure mode is a wall of `permission denied` in
the middle of a migration run. **Automate it before multi-tenant provisioning**, or it becomes a
recurring manual step in a process that cannot afford one.
