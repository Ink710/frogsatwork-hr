# ADR-001 — Email is disabled in the deployed demos

**Status:** accepted · **Date:** 2026-08 · **Applies to:** all deployed apps

## Context

The suite sends real email: invites, set-password links, candidate stage notifications, interview
slot confirmations, and applicant magic links. The deployed demos are public portfolio artefacts
with seeded data and no real recipients.

## Options

1. **Wire a real provider** — demos send genuine mail. Costs money, needs a verified sending domain,
   and mails seeded addresses that do not belong to us.
2. **Disable outbound mail** — leave `SMTP_*` unset.
3. Ship a fake transport that logs instead of sending.

## Decision

**Option 2.** No `SMTP_*` variables in any deployed environment. Seeded logins are **pre-activated**,
so no one needs an invite to sign in. The invite → set-password flow is demonstrated in the Loom
walkthrough against local **Mailpit**.

Option 3 was rejected as needless: `sendMail` already throws, and callers already decide what a
failure means. Adding a null driver would mean a code path that only ever runs in production.

## Consequences

- The **applicant magic link cannot be received** on the deployed portal. Signing in as an applicant
  there requires reading the token out of the Vercel function logs. This is why the portal's
  screening-call notice has never been exercised end to end in production.
- `sendMail` failures surface in logs rather than being swallowed — deliberate, see
  [notification-seam](../modules/notification-seam.md).
- Turning mail on later is configuration only: set `SMTP_*` and `RECRUITING_REPLY_TO`. No code change.

## Implications for the product build

A paying tenant needs working email on day one — this ADR is a **demo** decision, not a product one.
Reversing it means choosing a provider, verifying a domain, and deciding who the `From` is per
tenant. Treat that as real work, not a config flip.
