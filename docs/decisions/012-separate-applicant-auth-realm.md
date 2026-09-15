# ADR-012 — Applicants get their own auth realm, not a `User` row with a role

**Status:** accepted · **Date:** 2026-08-24 · **Applies to:** `candidate-portal` vs the three staff apps

## Context

Applicants need to sign in to track their applications. The suite already has authentication:
`User` + bcrypt + a `Role` enum, shared by three apps.

## Options

1. **Add a `CANDIDATE` role to `User`** — reuses everything, and puts applicants one enum value away
   from staff permissions. Every role check in the codebase becomes security-relevant to strangers.
2. **A separate identity table and a separate realm.**

## Decision

**Option 2.** `CandidateAccount` (joined to `Candidate`), its own Auth.js instance, its own secret,
its own cookie name, and a session shape with **no `role` and no `employeeId`**.

The separation is **mechanical, not nominal**:

| Mechanism | Effect |
|---|---|
| Distinct cookie name | the two never occupy the same slot — in dev all four apps share `localhost`, where cookies ignore the port |
| `CANDIDATE_AUTH_SECRET` | a staff cookie cannot be decrypted as an applicant one, or vice versa |
| Different session shape | staff code cannot mistake one for the other — the fields are not there |
| `getApplicant()` ≠ `getViewer()` | different name, different return type, cannot be passed interchangeably |

Passwordless by design: a `Credentials` provider taking a one-time token, **not** Auth.js's built-in
magic-link provider — that one needs a database adapter, which would mean new tables and switching
the whole suite's session strategy.

## Consequences

- An applicant has no role, so no RLS identity — which is why the portal reads through doorways.
  See [portal-seam](../modules/portal-seam.md).
- Sessions are stateless JWTs, so **revocation only bites at the data layer**: closing an account or
  erasing a candidate makes every doorway return nothing.
- Two secrets to manage. ⚠️ **Never unify them.** It looks like removing a duplicate env var; it
  removes the cryptographic boundary between an applicant and an HR admin.

## Implications for the product build

**The staff/applicant split survives the merge.** Merging the three staff apps into one is right;
merging the portal into them is not. When SSO lands (M16) it applies to the staff realm only.

The blocker for staff SSO is not this ADR — it is that `vercel.app` is on the Public Suffix List, so
`*.vercel.app` subdomains cannot share a cookie. Options are costed in
[auth-realms](../modules/auth-realms.md#-what-actually-blocks-sso-the-m16-problem).
