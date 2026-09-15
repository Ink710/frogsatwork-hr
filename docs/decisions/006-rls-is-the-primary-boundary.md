# ADR-006 — Row authorization lives in the database, not the app

**Status:** accepted · **Date:** 2026-07 · **Applies to:** all apps

## Context

Something has to decide which rows a viewer may see. The conventional answer is a `where` clause in
every query, or a repository layer that adds one.

## Options

1. **App-layer scoping** — every query carries its own filter. Familiar, portable, and **one
   forgotten `where` is a leak**, with nothing to catch it.
2. **Row-Level Security in Postgres** — policies evaluate per row, below the ORM.
3. A views-only layer.

## Decision

**Option 2.** ~55 policies across 39 tables, delegating to 15 `app_can_*` predicate functions.
`withViewer` sets four transaction-local session variables that the predicates read.

App-layer guards still exist, but only for what RLS **structurally cannot** do:

| Question | Enforced by |
|---|---|
| which **rows** | RLS |
| which **columns** (compensation) | app code — RLS cannot hide a column |
| which **verbs** (may you approve?) | app code — an action is not a row |

## Consequences

- **A query needs no security clause.** `tx.employee.findMany()` with no filter returns exactly what
  the viewer may see. Forgetting a `where` leaks nothing.
- Queries **must** run on the `tx` from `withViewer`. A query on the global client is a different
  pooled connection with no variables set.
- Authorization is testable at the database level, independent of any app.
- Cost: authorization logic is in SQL, reviewed in migrations, and harder to unit-test than a
  function. Accepted — the alternative's failure mode is silent.
- A *column* that must be invisible to some people who can see the row has to become **its own
  table** (this is why `SalaryBand` and `Offer` are separate).

## Implications for the product build

**Do not move authorization into the app layer when merging the apps.** A single merged app makes an
app-layer guard look tidier — one middleware, one place. It would be a downgrade: the merged app
would still talk to the same database, and the policies are what make a forgotten filter harmless.

New tables holding people-data need RLS **in the same migration that creates them**. A table with
RLS off is fully readable by `hris_app`, and nothing will tell you.
