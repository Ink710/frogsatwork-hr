# @hris/types

**Zod schemas and derived TypeScript types for the EMPLOYEE domain.**

- **Scope is narrower than the name suggests.** This is employee-records' validation vocabulary —
  hiring lives in [`@hris/recruiting`](../recruiting), time in
  [`@hris/workable-hours`](../workable-hours). The three are siblings, not layers.
- **Zod is its only dependency.** No `@hris/database` import: the enum tuples here (`EMPLOYMENT_TYPES`,
  `FLSA_CLASSIFICATIONS`, `ASSIGNABLE_ROLES`, `DOCUMENT_TYPES`, …) are local `as const` mirrors of the
  Prisma enums. That keeps the package testable with no database and no generated client — see
  [ADR-008](../../docs/decisions/008-domain-packages-mirror-enums.md).
- **It holds small pure rules too**, not just shapes: `CORRECTION_WINDOW_DAYS` and
  `isWithinCorrectionWindow` are the 7-day line between *correcting* a record and *changing* it.

```ts
import { employeeCreateSchema, terminationSchema, isWithinCorrectionWindow } from "@hris/types";
```

**Consumers:** `employee-records` only. `ats` and `time-management` declare it in `package.json` but
import nothing from it; `candidate-portal` does not depend on it at all.

> ⚠️ **A schema here is never the only enforcement.** Anything that must be true regardless of which
> form was used is *also* a database constraint. Mirrored rules must agree — see
> [`docs/modules/rls-chain.md`](../../docs/modules/rls-chain.md).

**Tests:** `src/employee.test.js` — `pnpm vitest run --project unit packages/types`
