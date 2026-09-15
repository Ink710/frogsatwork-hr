# The portal seam — how applicants read ATS data

> **Covers:** `apps/candidate-portal/lib/queries.js` · `apps/candidate-portal/lib/auth.js` ·
> `packages/recruiting/src/portal.ts` · `apps/ats/lib/portal-url.js` · the 11 `app_applicant_*`
> doorways and the 3 candidate-identity functions
> **Anchors:** `apps/candidate-portal/tests/portal.itest.js` · `schedule.itest.js` ·
> `screening-window.itest.js` · `apply.itest.js`
> **Lies if:** any `app_applicant_*` function starts taking an id other than the account id, or the
> portal gains a `withViewer` call.
> **Last verified:** 2026-09-12

The ATS owns candidates, applications, jobs and interview slots. The Candidate Portal shows a
person their own slice of all four. The two apps **share no query code and no session**, and this
document is the contract that makes that work.

---

## What crosses the seam

| Direction | What moves | How |
|-----------|-----------|-----|
| ATS → portal | The applicant's own applications, status, timeline, interviews, claimable slots, résumé, profile | 11 `app_applicant_*` doorway functions |
| ATS → portal | The *vocabulary* — which internal stage means what to an applicant | `@hris/recruiting`, imported by both |
| ATS → portal | Where to send someone in an email | `portalUrl()` in the ATS |
| portal → ATS | A new application, a claimed slot, a profile edit, a résumé | `app_submit_application`, `app_applicant_claim_slot`, `app_applicant_save_profile`, `app_applicant_set_resume` |

What deliberately does **not** cross: any query helper, any component, any auth code. The two apps
agree on meaning through a shared *domain package* and on data through *database functions* —
never by importing each other.

---

## ⚠️ The rule: derive the identity, never accept it

Every applicant doorway takes **one** parameter, the account id, and resolves everything else
itself.

```js
// apps/candidate-portal/lib/queries.js — the shape of every private read
export async function getMyApplications(accountId) {
  return prisma.$queryRaw`SELECT ... FROM app_applicant_applications(${accountId})`;
}
```

The account id comes from the session and nowhere else:

```js
// apps/candidate-portal/lib/auth.js
export async function getApplicant() {
  const session = await auth();
  const u = session?.user;
  if (!u?.id || !u?.candidateId) return null;
  return { accountId: u.id, candidateId: u.candidateId, orgId: u.orgId };
}
```

**Why this is the whole design.** A `SECURITY DEFINER` function runs as the table owner, and the
owner bypasses RLS (see [rls-chain.md](rls-chain.md)). So a doorway that accepts an application id
from its caller is not protected by anything — the applicant would be *naming* the record they want,
and could name someone else's. Deriving the application from the account makes the dangerous request
**unrepresentable**: there is no parameter in which to put the wrong id.

This is why the portal's pages are so thin. `/portal` never mentions an application; it asks for the
session and renders what comes back. "Showing someone else's application" is not a bug you could
write there.

### The one exception, and why it is safe

`app_claim_interview_slot(slot_id, application_id)` — added in M9 for staff — **does** trust an
application id. It is safe only because its callers sit behind `app_can_manage_job`.

When the portal needed the same capability in M11, the function was **not** reused. A second
doorway was added:

| | `app_claim_interview_slot` | `app_applicant_claim_slot` |
|---|---|---|
| Takes | `(slot_id, application_id)` | `(account_id, slot_id)` |
| Trusts the caller's application id | **Yes** | **No** — derives it |
| Safe because | `app_can_manage_job` is checked in front of it | there is nothing to forge |
| Callers | ATS staff | the portal |

> The migration says it in its own words: *"A candidate-facing action must never accept one: the
> applicant would be naming the application they are booking for, and could name somebody else's."*
> **Keep that split.** If a future feature needs a staff doorway from the portal, add a doorway —
> do not relax an existing one.

Both write through the same unique index, so "one slot per round" stays a database constraint rather
than a promise made twice.

---

## The public half

The browse, detail and apply pages have **no session at all** — not an empty one, none. They run a
bare `prisma` client against three public doorways:

| Doorway | Returns |
|---------|---------|
| `app_public_jobs()` | Only reqs that are OPEN **and** published, and only the columns a stranger may read — no openings count, no hiring team, no department, no `orgId` |
| `app_public_job_questions(job_id)` | That req's custom questions |
| `app_submit_application(...)` | Writes one application; validates required answers server-side |

**The projection is the boundary.** `getPublishedJobs()` does no filtering of its own, deliberately —
a second filter in JavaScript would be a second place for the rule to drift.

`/jobs/[id]` calls `notFound()` unless the posting is OPEN and published, so guessing the id of a
draft or confidential req is **indistinguishable** from guessing an id that never existed. A
different response for "exists but hidden" would turn the page into a way to enumerate unannounced
roles.

> ⚠️ **Adding anything to `lib/queries.js`?** It must go through a doorway or through RLS with a
> real viewer. A bare `prisma.<model>.findMany()` there runs as `hris_app` with no session variables
> — which RLS narrows to *nothing* today, so it looks harmless. It stops being harmless the day
> someone adds a table without RLS. Keep the discipline explicit rather than relying on that.

---

## Shared vocabulary, not shared code

`packages/recruiting/src/portal.ts` maps each internal `ApplicationStage` to what an applicant is
told. Both apps import it, which is how a stage rename can't quietly desynchronise the two.

```ts
publicStatusFor("SCREEN")   // → the applicant-facing view of that stage
buildApplicantTimeline(...) // → the events an applicant may see, in order
APPLICANT_PROGRESS_KEYS     // ["APPLIED","SCREEN","INTERVIEW","OFFER","HIRED"]
```

> ⚠️ **A stated, accepted trade:** the mapping is currently **1:1 with the internal pipeline**, so
> moving someone internally is immediately visible to them. That is a disclosure decision, not an
> accident — it is written down in the file, and `portal.test.js` fails the build if the map and the
> enum drift apart. Revisit it deliberately if internal stages ever get more granular than what you
> want applicants to watch in real time.

**What is withheld** is decided in SQL, not in the UI:

- Interview slots reach an applicant only when **published and claimed by them**. A proposed or
  merely confirmed time is internal — it must not reach the person it concerns before anyone decided
  to offer it.
- The **screening-call window** is returned only while the application is at `SCREEN`, by a `CASE` in
  the doorway. `screening-window.itest.js` asserts every other stage returns null *on a req that has
  a window configured* — so a null proves the gate fired, not that there was nothing to withhold.
- Every time carries its canonical `timeZone`, because "15:00" is not a time to someone whose own
  zone you don't know.

---

## Identity: there is no registration

An account exists only for someone who has **actually applied**, and is created lazily the first
time they ask for a link.

| Function | Does |
|----------|------|
| `app_issue_candidate_login(email, token_hash, expires_at)` | Finds or creates the account, stores a hashed single-use token |
| `app_redeem_candidate_login(token_hash)` | Spends it once and returns the account |
| `app_close_candidate_account(candidate_id)` | Closes it — called from the ATS at onboarding, HR-only |

Consequences worth knowing:

- `/sign-in` **makes no promise** about whether it found anything. Saying "no such account" would
  turn it into a checker for who has applied where.
- Sessions are stateless JWTs, so the **data layer is the only place revocation can bite**. Closing
  an account or anonymising a candidate makes every doorway return nothing, immediately, even to a
  session already issued. `screening-window.itest.js` locks both cases with a control first.
- Test fixtures must call `app_issue_candidate_login` to materialise an account. A seeded candidate
  has **no `CandidateAccount` row** — asserting against a null row is how the first draft of a test
  here "failed" while the guards were working perfectly.

---

## Linking back: `portalUrl()`, not `APP_BASE_URL`

The ATS sends most stage notifications, and its `APP_BASE_URL` points at the ATS — **a staff tool
behind a login**. Linking an applicant there sends them to a sign-in page for an account they do not
have and must never have.

```js
// apps/ats/lib/portal-url.js
export function portalUrl() {
  return `${process.env.PORTAL_BASE_URL ?? "http://localhost:3003"}/portal`;
}
```

> ⚠️ `PORTAL_BASE_URL` **must** be set in production, or every notification links to localhost. The
> default exists so local development needs no extra configuration. See `docs/DEPLOYMENT.md`.

---

## Working on this safely

- **New applicant-facing data?** Add a doorway taking the account id. Do not add a parameter.
- **Never call `withViewer` in the portal.** There is no viewer; it would throw, and if it didn't it
  would be wrong.
- **Test the withheld case with a control** — configure the thing, then assert it is *not* returned.
  A null is only evidence when the same call returns non-null under the condition that should allow it.
- **Changing a stage's applicant-facing meaning?** Change `portal.ts`, not a portal page. Two apps
  read it.

## Read next

- [rls-chain.md](rls-chain.md) — why a doorway is needed at all, and the `SECURITY DEFINER` rules
- [auth-realms.md](auth-realms.md) — where the applicant session comes from
- [ADR-010](../decisions/010-no-applicant-self-booked-screening.md) — why recruiters phone instead
