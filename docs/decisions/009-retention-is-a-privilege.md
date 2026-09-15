# ADR-009 — "Never hard-delete" is a database privilege, not a convention

**Status:** accepted · **Date:** 2026-08-30 (M14) · **Applies to:** `Employee`, `EmployeeHistory`, `Candidate`, `Application`

## Context

HR records must be retained for compliance. The rule was respected everywhere by convention: the code
soft-deletes, and no query calls `delete` on those tables. A convention holds until someone writes
one line that breaks it — and nothing would have failed.

## Options

1. **Keep the convention** and rely on review.
2. **Revoke the privilege** from the runtime role.
3. Database triggers that raise on DELETE — works, but runs per row and hides the rule in a place
   people look at last.

## Decision

**Option 2.**

```sql
REVOKE DELETE ON "Employee", "EmployeeHistory", "Candidate", "Application" FROM hris_app;
```

The owner is deliberately still allowed, so migrations and genuine data surgery remain possible.

## Consequences

- There is **no code path, and no bug, that can violate the rule.** The privilege is checked before
  any row is considered — which is why the tests assert against ids that do not exist.
- A future `deleteMany` fails loudly at development time rather than quietly destroying history.
- `apps/ats/tests/hardening.itest.js` locks all four **through the restricted role**, with a control
  proving the role can still delete elsewhere. Without that control the assertions would also pass
  if the role had simply lost every privilege — a green suite proving nothing.
- Candidate **erasure** still works: it runs through `app_erase_candidate`, a `SECURITY DEFINER`
  doorway executing as the owner. Retention and the right to erasure are reconciled there, not by
  weakening this.

## Implications for the product build

This is the shape to copy for every rule that must hold regardless of code: **make it a privilege or
a constraint, not a habit.** As more apps are added, each new table holding people-data should be
assessed for the same revoke at the point it is created.

⚠️ On a fresh database the revokes come from the migration, but they only mean anything if
`hris_app` exists and the app actually connects as it — see [ADR-005](005-two-role-database-split.md).
