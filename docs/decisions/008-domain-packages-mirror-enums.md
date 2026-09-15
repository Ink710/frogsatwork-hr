# ADR-008 — Domain packages mirror Prisma enums instead of importing them

**Status:** accepted · **Date:** 2026-07 · **Applies to:** `@hris/types`, `@hris/recruiting`, `@hris/workable-hours`

## Context

The domain packages hold Zod schemas and pure rules. Many need the same enum values the Prisma
schema defines (`EMPLOYMENT_TYPES`, `JOB_STATUSES`, …). The obvious move is to import them from
`@hris/database`.

## Options

1. **Import the generated enums** — one definition, guaranteed in sync, and it drags the generated
   Prisma client into every consumer.
2. **Mirror them as local `as const` tuples.**

## Decision

**Option 2.** Each domain package declares its own tuples and keeps **zod as its single dependency**.

## Consequences

- These packages are **testable with no database and no generated client**. Their tests run in
  milliseconds in the `unit` project, and the same pure functions run in the browser for live
  previews.
- `@hris/database` stays a leaf that apps depend on, rather than something every package pulls in.
- **Cost: the mirrors can drift from the schema.** This is the real trade and it is accepted with
  mitigation rather than ignored — where drift would be dangerous, a test asserts exhaustiveness.
  `packages/recruiting/src/portal.test.js` fails the build if a stage exists with no applicant-facing
  mapping.

## Implications for the product build

When adding an enum value to `schema.prisma`, **grep the domain packages for the tuple**. The
compiler will not tell you: the tuple is a separate literal.

The pattern is worth keeping as apps are added — a new domain package should copy it rather than
import from the database. But any *new* mirror that gates a user-visible decision needs an
exhaustiveness test in the same commit, the way `portal.ts` has one.
