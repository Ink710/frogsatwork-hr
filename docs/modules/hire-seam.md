# The hire seam — a candidate becomes an employee

> **Covers:** `apps/employee-records/app/employees/[id]/actions.ts` (the `createEmployee` tail) ·
> `apps/employee-records/lib/queries.ts` (`getOnboardingQueue`, `getHireForPrefill`) ·
> `app_link_hire` · migration `20260808150000_hire_seam`
> **Anchors:** `apps/employee-records/tests/hire.itest.js` · `apps/ats/tests/hardening.itest.js`
> **Lies if:** `app_link_hire`'s role list changes, `ApplicationStage` gains a stage past `HIRED`, or
> the ATS gains write access to `Employee`.
> **Last verified:** 2026-09-12

Two apps own two halves of one event. The ATS decides someone is hired; employee-records creates
the employee. **Neither writes the other's tables.** One `SECURITY DEFINER` function is the whole
interface.

---

## The flow

```
ATS            pipeline move → Application.stage = 'HIRED'        ← the DECISION
                    ↓
employee-records   /employees/new  ← getOnboardingQueue() lists hired-but-not-yet-onboarded
                    ↓              ← getHireForPrefill(appId) prefills name, email, agreed pay
                   createEmployee()  creates the Employee row in its own transaction
                    ↓
                   app_link_hire(applicationId, employeeId)        ← records the ONBOARDING
                    ↓
                   Application.hiredEmployeeId set · candidate portal account closed ·
                   Job flipped to FILLED once every opening has a hire
```

> **The line the whole design turns on:** *reaching `HIRED` is the decision; `app_link_hire` records
> the onboarding.* The function **never invents the decision** — it refuses an application that is
> not already `HIRED` (`NOT_HIRED`). Onboarding someone is not how they get hired.

---

## Why a doorway and not a plain update

An `HR_GENERALIST` is fully entitled to create an employee — and has **no write access to
`Application` at all**, because `app_can_manage_job` excludes them. Without the doorway, the person
doing the onboarding could not record it.

The alternatives were worse: granting HR write access to the ATS's pipeline widens a boundary
permanently for one narrow act, and doing it from the ATS instead would mean the ATS creating
`Employee` rows — which is exactly the coupling this suite avoids.

So the function does, atomically, four things no single role may do directly:

| Step | Why it's here |
|------|---------------|
| Set `Application.hiredEmployeeId` | the link itself |
| `app_close_candidate_account(candidate)` | they are staff now — the portal stops being a door into their own interview and offer history. A no-op when they never made an account, the common case |
| Count hires vs `Job.openings` | requisition lifecycle |
| Flip `Job.status` to `FILLED` | **only from `OPEN`** — never resurrect a `CLOSED` or `PAUSED` req |

```sql
-- Onboarding belongs to whoever owns employee records — NOT to recruiters.
IF coalesce(current_setting('app.current_role', true), '') NOT IN ('HR_ADMIN','HR_GENERALIST','SYSTEM') THEN
  RETURN 'FORBIDDEN';
END IF;
```

> ⚠️ **That `coalesce` is the M14 fix, not tidying.** Without it, `NULL NOT IN (...)` is NULL, the
> `IF` never fires, and the guard is skipped for any caller with no session — the opposite of what
> it reads as. Full explanation in [rls-chain.md](rls-chain.md#-failure-mode-1--a-guard-written-with-not-in-fails-open).

---

## Return codes — it answers, it does not throw

`app_link_hire` returns a string. The caller treats `OK` and `ALREADY_LINKED` as success:

| Code | Meaning |
|------|---------|
| `OK` | linked |
| `ALREADY_LINKED` | someone already did it — **idempotent, so a retry is safe** |
| `NOT_HIRED` | the application has not reached `HIRED`; nothing was written |
| `NOT_FOUND` | no such application, **or** the employee belongs to a different tenant |
| `FORBIDDEN` | the caller's role may not onboard |

> `NOT_FOUND` deliberately covers the cross-tenant case too: telling a caller "that application
> exists, but not for you" is itself a disclosure.

---

## ⚠️ Ordering: the link runs AFTER the employee transaction commits

```ts
// A recruiting-side problem must never roll back a successfully created employee.
const rows = await withViewer(viewer, (tx) =>
  tx.$queryRaw`SELECT app_link_hire(${applicationId}, ${newId.employeeId}) AS result`);
if (result !== "OK" && result !== "ALREADY_LINKED") {
  return { error: `Employee created, but the application could not be linked (${result}). Link it from the ATS.` };
}
```

Two decisions worth keeping:

- **Outside the transaction.** The employee is the thing that must exist. A failure to link is an
  inconsistency, not a reason to discard a correctly created person.
- **Surfaced, never swallowed** — unlike the best-effort invite email next to it. An employee who
  exists but isn't linked is a real inconsistency HR should know about, and the message says exactly
  what to do about it. Idempotency is what makes that advice safe to follow.

---

## The read half, and why it is stricter than it looks

`getHireForPrefill` carries the **agreed salary** across the seam, so it is gated harder than the
queue:

| Viewer | Gets |
|--------|------|
| `HR_ADMIN` | candidate **and** accepted figures — the only role that can both hire and set pay |
| `HR_GENERALIST` | the candidate, **no salary** — they cannot set comp at all |
| `RECRUITER` | **nothing**, though they can read the offer inside the ATS |
| `MANAGER` | nothing |

And: **nothing while the offer is only `EXTENDED`.** A proposal is not a fact about pay. Only an
accepted offer prefills.

`getOnboardingQueue()` is likewise empty for a hiring manager — *visibility follows capability, not
just RLS*. Seeing a req does not mean you are the person who onboards from it.

---

## Working on this safely

- **Never let the ATS write `Employee`.** If the ATS needs something recorded in employee-records,
  that is a new doorway, not a new grant.
- **Keep it idempotent.** The caller retries; `ALREADY_LINKED` must stay a success.
- **Adding a step?** Put it inside the function so it shares the atomicity, and ask whether it should
  block the link if it fails.
- **Changing the role list?** It is duplicated nowhere — but `hire.itest.js` and
  `hardening.itest.js` both assert it, including the no-session case.

## Read next

- [rls-chain.md](rls-chain.md) — the guard idiom and why `NOT IN` was wrong
- [portal-seam.md](portal-seam.md) — what closing the candidate account does to a live session
