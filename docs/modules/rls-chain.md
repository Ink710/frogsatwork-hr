# The RLS chain — how the database knows who is asking

> **Covers:** `packages/auth/src/rls.ts` · `packages/auth/src/session.ts` · the 15 `app_can_*`
> predicates · ~55 RLS policies across 39 tables
> **Anchors:** `apps/employee-records/tests/rls.itest.js` · `apps/ats/tests/hardening.itest.js`
> **Lies if:** a fifth session variable is added, `relforcerowsecurity` is turned on, or a predicate
> stops taking its scope from `app.current_org_id`.
> **Last verified:** 2026-09-12

This is the single most important mechanism in the suite, and the one where a mistake is silent.
Everything else in this document exists to make two failure modes impossible to write by accident.

---

## The chain, end to end

```
getViewer()            reads the JWT  →  { userId, employeeId, role, orgId }
   ↓
withViewer(viewer, cb) opens ONE transaction and sets four session variables LOCAL to it
   ↓
tx.employee.findMany() ordinary Prisma — no WHERE clause for security
   ↓
RLS policy            USING (app_can_see_employee(id))
   ↓
app_can_see_employee  SECURITY DEFINER, reads the four variables, returns true/false per row
```

The payoff is the third line. **A query carries no security clause of its own.** You write
`tx.employee.findMany()` with no filter and get back exactly the rows this viewer may see, because
the filtering happens below the ORM. A developer who forgets a `where` leaks nothing.

### Why a transaction, and not just `SET`

The app runs on a **pooled** connection. A plain `SET` would outlive the request and the next
request to borrow that connection would inherit someone else's identity — a catastrophic, entirely
silent bug. `set_config(..., true)` makes each setting **transaction-local**, so it vanishes when the
transaction ends. That is why `withViewer` gives you a `tx` and why queries must run on it: a query
issued on the global `prisma` client during a `withViewer` block is on a *different* connection with
none of the variables set.

### The four variables

| Variable | Set from | Read by | Reads across migrations |
|----------|----------|---------|------------------------|
| `app.current_org_id` | `viewer.orgId` | every tenant-scoped predicate | 31 |
| `app.current_role` | `viewer.role` | role branches in predicates and guards | 27 |
| `app.current_employee_id` | `viewer.employeeId` | self-access and subtree walks | 24 |
| `app.current_user_id` | `viewer.userId` | almost nothing | 1 |

> `app.current_user_id` is set on every request and read exactly once. That is not an oversight:
> authorization here is about the **employee**, not the login. Keep setting it — it is the join back
> to `User` if a future policy needs it — but do not reach for it when you mean `current_employee_id`.

---

## The shape every predicate follows

```sql
CREATE OR REPLACE FUNCTION app_can_see_employee(emp_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM "Employee" e
    WHERE e.id = emp_id
      AND e."orgId" = current_setting('app.current_org_id', true)   -- ← tenancy, first and always
      AND (
        current_setting('app.current_role', true) IN
          ('HR_ADMIN', 'HR_GENERALIST', 'PAYROLL_ADMIN', 'SYSTEM')  -- ← positive list
        OR e.id = current_setting('app.current_employee_id', true)
        OR ( current_setting('app.current_role', true) = 'MANAGER'
             AND e.id IN (SELECT app_subtree(current_setting('app.current_employee_id', true))) )
      )
  )
$$;
```

Four properties, each load-bearing:

1. **`SECURITY DEFINER`** — the predicate itself must read `Employee` to answer, and the caller may
   not be allowed to. It runs as the owner so it can.
2. **`SET search_path = public`** — without it, a caller who can create a schema could shadow
   `"Employee"` and have owner-privileged SQL read *their* table.
3. **Tenancy is the first condition, not the last.** Multi-tenancy is one `AND` in ~31 places; it is
   never inferred from anything else.
4. **Every test is a positive `=` or `IN`.** This is the whole safety argument — see below.

Policies then delegate, and stay dull:

```sql
CREATE POLICY employee_visibility ON "Employee" FOR ALL
  USING (app_can_see_employee(id))         -- gates reads, and which rows UPDATE/DELETE can target
  WITH CHECK (app_can_see_employee(id));   -- gates rows being written
```

> **`FOR ALL` includes `SELECT`.** And multiple permissive policies on one table are **OR**ed, not
> ANDed — adding a second policy can only ever *widen* access. If you need to narrow, change the
> existing policy; do not add another.

---

## ⚠️ Failure mode 1 — a guard written with `NOT IN` fails OPEN

This one shipped. Two functions had it.

```sql
-- WRONG. Looks like a guard. Is not one.
IF current_setting('app.current_role', true) NOT IN ('HR_ADMIN', 'HR_GENERALIST', 'SYSTEM') THEN
  RETURN 'FORBIDDEN';
END IF;
```

With no session, `current_setting(..., true)` returns **NULL**. And `NULL NOT IN (...)` evaluates to
**NULL, not TRUE** — so the `IF` does not fire, the `RETURN` is skipped, and execution falls straight
through into the privileged body. The guard refused a signed-in recruiter and waved through a
connection that had never identified itself. Exactly inverted.

```sql
-- RIGHT. coalesce collapses the NULL into a value the list genuinely does not contain.
IF coalesce(current_setting('app.current_role', true), '') NOT IN ('HR_ADMIN', 'HR_GENERALIST', 'SYSTEM') THEN
  RETURN 'FORBIDDEN';
END IF;
```

**Why the predicates above were never vulnerable:** they ask positive questions. `'' = 'HR_ADMIN'` is
FALSE and `'' IN (...)` is FALSE, so an unidentified caller matches nothing and sees nothing. The
rule that falls out:

> **Prefer a positive test. If you must write a negative one, `coalesce` it first.**
> `withViewer` already helps from the app side — it writes `''` rather than NULL for an absent field
> — but that only protects callers who went through `withViewer`. Every public surface in this suite
> deliberately uses a bare `prisma` client with no session variables at all, so the SQL must defend
> itself.

**How it was caught:** by testing the *no-session* case, which a logged-in test never exercises. The
tell was subtle — `app_link_hire` returned `NOT_HIRED`, a business check that sits **below** the role
gate, which proved the gate had already been passed. A test asserting only "it didn't succeed" would
have gone green.

---

## ⚠️ Failure mode 2 — the table owner bypasses RLS entirely

`relforcerowsecurity` is **off** on these tables. A table's owner is therefore exempt from its own
policies. Connect as `postgres` and every policy in this document evaporates.

This produced a **false cross-tenant leak report**: a tenant-isolation check run as the owner showed
every persona seeing every row, which reads exactly like a catastrophic breach. Re-run with
`SET LOCAL ROLE hris_app`, isolation was perfect.

> **The tell:** in a real leak, personas see *different* wrong things. If every persona sees the
> **same** count, RLS is switched off, not leaking. Check the role before believing the finding.

```sql
-- Any psql check of a policy MUST start here, or it proves nothing:
SET LOCAL ROLE hris_app;
SELECT set_config('app.current_org_id', '...', true), set_config('app.current_role', 'MANAGER', true);
```

And always run a **control** that shows the wrong version failing. A query returning zero rows is
only evidence if you have seen the same query return rows under different settings.

---

## The two database roles

| Role | Used by | RLS applies? | Notable restrictions |
|------|---------|--------------|----------------------|
| `postgres` (owner) | migrations, Prisma Studio, psql | **No** — bypasses everything | none |
| `hris_app` (restricted) | every running app, via `DATABASE_URL` | Yes | no `UPDATE`/`DELETE` on the audit log; no `DELETE` on `Employee`, `EmployeeHistory`, `Candidate`, `Application` |

Those `REVOKE`s are how "never hard-delete" stops being a convention and becomes a privilege: there
is no code path, and no bug, that can violate it. `apps/ats/tests/hardening.itest.js` asserts each
one **through the restricted role**, with a control proving the role can still delete elsewhere —
without that control, the four assertions would also pass if the role had simply lost every
privilege.

> `hris_app` is **not created by any migration**. On a fresh database create it first; 64
> `GRANT ... TO hris_app` statements depend on it existing. `docs/deploy/neon-app-role.sql` is the
> bootstrap. See [ADR-005](../decisions/005-two-role-database-split.md).

---

## Working on this safely

- **Never query user data on the global `prisma` client.** Use `withViewer` and the `tx` it hands you.
  The exceptions are deliberate and few: public doorways, which have their own boundary — see
  [portal-seam.md](portal-seam.md).
- **Adding a table that holds people-data?** Enable RLS and add a policy in the same migration. A
  table with RLS off is readable by `hris_app` in full, and nothing will tell you.
- **Adding a policy?** Remember permissive policies OR together. Widen deliberately; narrow by editing.
- **Verify in psql before trusting app code**, as the restricted role, with a control. The app's green
  test can be green because the query is wrong in a compensating way.

## Read next

- [portal-seam.md](portal-seam.md) — the boundary for callers who have no session at all
- [auth-realms.md](auth-realms.md) — where `viewer` comes from, and the second realm that has none
- [ADR-006](../decisions/006-rls-is-the-primary-boundary.md) — why the database and not the app layer
