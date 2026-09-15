# Auth realms — two login systems, and why they can't merge yet

> **Covers:** `packages/auth/src/auth.config.js` · `packages/auth/src/session.ts` ·
> `apps/candidate-portal/lib/auth.js` · `apps/candidate-portal/lib/auth.config.js` ·
> the four `proxy.js` matchers
> **Anchors:** `apps/candidate-portal/tests/auth.itest.js` · `packages/auth/src/roles.test.js`
> **Lies if:** the portal adopts `@hris/auth`, the two secrets are unified, or the apps move off
> `*.vercel.app` onto a shared custom domain.
> **Last verified:** 2026-09-12

There are **two independent authentication realms** in this suite. This document says what separates
them, why the separation is mechanical rather than a naming convention, and what actually blocks
single sign-on today — which is the first thing M16 has to solve.

---

## The two realms

| | **Staff realm** | **Applicant realm** |
|---|---|---|
| Apps | `employee-records`, `time-management`, `ats` | `candidate-portal` |
| Package | `@hris/auth` | none — `apps/candidate-portal/lib/auth.js` |
| Identity table | `User` (joined to `Employee`) | `CandidateAccount` (joined to `Candidate`) |
| Credential | email + password (bcrypt) | **emailed one-time link** — no password exists |
| Secret | `AUTH_SECRET` | `CANDIDATE_AUTH_SECRET` |
| Cookie | `authjs.session-token` (Auth.js default) | `candidate-portal.session-token` |
| Sign-in page | `/login` | `/sign-in` |
| Session shape | `{ userId, employeeId, role, orgId }` | `{ accountId, candidateId, orgId }` |
| Reaches data via | `withViewer` → RLS | `app_applicant_*` doorways |

Both use Auth.js v5 with **JWT sessions** (no database session table). That single fact drives most
of what follows.

---

## ⚠️ The separation is mechanical, not nominal

It would be easy to assume "different app, different cookie" is enough. It isn't — **in development
all four apps share `localhost`, and cookies are scoped per HOST, ignoring the port.** All four
therefore write into the same cookie jar. Two things make confusion impossible rather than merely
unlikely:

1. **A distinct cookie name.** The staff apps use Auth.js's default; the portal names its own. The
   two never occupy the same slot, so signing into one cannot clobber the other.
2. **Its own secret.** Even if a staff cookie were presented under the portal's name, it could not be
   decrypted — and an applicant cookie is equally meaningless to the staff apps. The realms are
   **cryptographically** separate.

And a third, defence in depth at the type level:

3. **The session shapes have nothing in common.** An applicant session carries no `role` and no
   `employeeId`. Downstream staff code cannot accidentally treat one as a `Viewer` because the
   fields simply are not there — and `getApplicant()` is deliberately a *different function with a
   different name* from `getViewer()`, so nothing can pass one where the other is expected.

> **Do not "simplify" this by sharing `AUTH_SECRET`.** It looks like removing a duplicate
> environment variable. It actually removes the cryptographic boundary between an applicant and an
> HR admin. `auth.itest.js` tests the property; `.env.example` warns about it at the variable.

---

## The applicant flow

There is **no registration anywhere**. An account exists only for someone who has actually applied,
and is created lazily the first time they ask for a link.

```
/sign-in  →  app_issue_candidate_login(email, token_hash, expires_at)   → email a RAW token
             (the raw token is never stored — only its hash)
/sign-in/verify?token=…  →  app_redeem_candidate_login(hash)  →  session
/sign-in/invalid         ←  unknown, expired, already used, or account closed
```

**Why a `Credentials` provider that takes a token, rather than Auth.js's built-in magic-link
provider:** the built-in one requires a database **adapter**, which would mean adding
`Account`/`Session`/`VerificationToken` tables and switching the *whole suite's* session strategy.
The custom provider is ~30 lines and changes nothing for the other three apps.

**Single use is atomic, not checked-then-set.** `app_redeem_candidate_login` verifies the hash, the
expiry and the account's open state, and clears the token, **in one statement**. Two requests
carrying the same link cannot both succeed, because the second one's `UPDATE` matches no rows.

> ⚠️ **Verification must not happen in a Server Component.** The token is spent by the time the
> component renders, so a re-render or a prefetch burns a valid link. `/sign-in/verify` is a Route
> Handler for that reason.

### Revocation lives in the data layer, and only there

Sessions are **stateless JWTs** — nothing checks a server-side session store on each request,
because there isn't one. So a session cannot be "revoked" in the usual sense. What actually bites is
that every doorway returns nothing:

| Event | Effect on a live session |
|-------|--------------------------|
| Account closed (candidate hired) | Every doorway returns nothing; existing link dies |
| Candidate erased (GDPR) | The account row is **deleted**, not blanked |
| Candidate archived (retention) | **Nothing** — housekeeping is not a judgement on them |

`auth.itest.js` locks all three, including the one that must *not* change behaviour.

---

## The proxy matchers, and the one that is inverted

| App | Matcher | Means |
|-----|---------|-------|
| `employee-records` | `/((?!api/auth\|api/health\|_next/…\|login\|set-password\|brand).*)` | protect everything **except** the allow-list |
| `time-management` | `…\|api/cron\|login\|brand).*)` | same, plus cron |
| `ats` | `…\|api/cron\|login\|brand\|careers).*)` | same, plus the public careers site |
| `candidate-portal` | `/portal/:path*` | **protect only this** — everything else is public |

> ⚠️ **In the portal, a route added outside `/portal` is PUBLIC. There is no second chance from the
> matcher.** Read `proxy.js` before adding a route there.
>
> What bounds the risk: `/portal`'s data comes from doorways keyed on the session's account id, so a
> route accidentally left outside `/portal` still cannot serve another person's data — with no
> session there is no id, and the doorway returns nothing. The proxy is the outer gate, not the only
> one. That is not permission to be careless about where a route lives.

The same "outer gate is not the only gate" posture is why `/portal/page.js` re-checks the session
itself instead of trusting the proxy.

> **`brand` must stay in every staff matcher.** Without it the logo PNGs `307` to `/login` and the
> sign-in page renders without its own logo.

---

## ⚠️ What actually blocks SSO (the M16 problem)

On **localhost** the staff apps already feel like one product: same host, cookies ignore the port,
same `AUTH_SECRET`, so a session set by one is sent to all three.

**In production that breaks, and not for a reason any code change can fix.** The three staff apps are
three Vercel projects on three `*.vercel.app` subdomains. To share a cookie they would have to set
it with `Domain=.vercel.app` — and **`vercel.app` is on the Public Suffix List**, so browsers refuse
to set a cookie at that scope. This is deliberate: it is what stops one `*.vercel.app` site from
setting a cookie readable by every other one.

So today: **SSO works locally and cannot work on the deployed demos.** That is a hosting fact, not a
bug, and no amount of Auth.js configuration changes it.

The ways out, honestly costed:

| Option | What it takes | Trade |
|--------|---------------|-------|
| **Custom domain** | Own `example.com`; deploy apps at `hr.`, `time.`, `ats.`; set the cookie on `.example.com` | Smallest change to the code — the realms and secrets stay exactly as they are. Needs a domain and DNS. |
| **One app, many routes** | Merge the three staff apps into a single Next.js app behind one origin | No cookie problem at all, and the direction Phase 2 is already heading. Largest code change. |
| **Central auth service** | A fourth origin issues tokens; each app redeems | Most flexible, most moving parts. Hard to justify at this size. |

**Whatever is chosen, it applies to the staff realm only.** The applicant realm must stay separate —
that separation is a security property, not an artefact of the apps being deployed apart. Merging
the three staff apps does not merge the portal into them.

---

## Working on this safely

- **Never import `@hris/auth` into the portal**, and never call `withViewer` there. There is no viewer.
- **Never share the two secrets**, even temporarily, even locally.
- **Adding a portal route?** Decide public vs private by where you put it, and check `proxy.js`.
- **Adding a staff app?** It inherits the staff realm by using `@hris/auth` — which also means it
  inherits the cookie-domain constraint above.

## Read next

- [rls-chain.md](rls-chain.md) — what a staff `viewer` unlocks once it exists
- [portal-seam.md](portal-seam.md) — how an applicant session reaches data with no RLS identity
- [ADR-012](../decisions/012-separate-applicant-auth-realm.md) — why applicants aren't `User` rows
