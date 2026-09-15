# employee-records

The **HR core** of FrogsAtWorkHR (port 3000): employee profiles, effective-dated history,
departments and budgets, the org chart, documents, and the audit trail.

```bash
pnpm --filter employee-records dev      # → http://localhost:3000
```

Run the one-time setup in the [root README](../../README.md) first (Docker, migrate, seed).

**Where things are**

| | |
|---|---|
| Reads | `lib/queries.ts` — every screen's data, all through `withViewer` |
| Writes | `app/employees/[id]/actions.ts` and the `actions.js` beside each route |
| Screens | [`docs/ARCHITECTURE.md` §7](../../docs/ARCHITECTURE.md#employee-records-appsemployee-records-port-3000) |
| Security | [`docs/modules/rls-chain.md`](../../docs/modules/rls-chain.md) |
| Onboarding a hire | [`docs/modules/hire-seam.md`](../../docs/modules/hire-seam.md) |

> ⚠️ **`hris_app` cannot DELETE `Employee` or `EmployeeHistory`**, and cannot UPDATE/DELETE the audit
> log. "Never hard-delete" is a database privilege here, not a convention in the code.

**Tests:** `pnpm vitest run --project integration apps/employee-records`
