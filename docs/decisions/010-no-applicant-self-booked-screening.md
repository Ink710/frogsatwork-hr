# ADR-010 — Recruiters phone candidates; applicants do not book screening calls

**Status:** accepted · **Date:** 2026-08-29 (M13) · **Applies to:** `ats`, `candidate-portal`

## Context

An application reaching `SCREEN` needs a screening call. The suite already had self-scheduling for
**interview slots** (M9/M11), so extending it to screening looked like the obvious next step.

## Options

1. **Applicant self-books a screening call**, reusing `InterviewSlot`. Requires making
   `InterviewSlot.roundId` nullable, since a screening call belongs to no interview round.
2. **Recruiters call; the portal displays a time window** the applicant should be reachable in.

## Why option 1 was analysed and discarded

`roundId` is currently **required**, and the once-per-round unique index depends on it. Making it
nullable turns that into once-per-(application, round-or-stage) — and

> ⚠️ **NULLs in a Postgres unique index are DISTINCT by default.** The naive version would silently
> let one candidate book several screening calls, with no error anywhere.

M8 hit exactly this trap on `NotificationDelivery` and fixed it with `NULLS NOT DISTINCT` — but that
clause is a **whole-index property**, and applying it here would have changed the semantics of the
existing M9/M11 slot pool. The workable form was
`NULLS NOT DISTINCT WHERE "claimedByApplicationId" IS NOT NULL`; it is recorded in migration
`20260829120000_screening_call_window` in case self-booking is ever revisited.

The design was then dropped for a product reason rather than a technical one: **screening is a phone
call a recruiter makes.** Modelling it as a bookable slot invents a scheduling obligation that does
not exist.

## Decision

**Option 2.** Three nullable columns on `Job` — `screeningCallFrom`, `screeningCallTo`,
`screeningCallTimeZone` — set by recruiters, shown to the applicant while at `SCREEN`.

`Job_screening_call_window_ck` enforces **all three or none**: a half-set window renders an
instruction nobody can follow ("be available between 09:00 and —").

## Consequences

- No schema change to `InterviewSlot`; the M9/M11 pool is untouched.
- The window is returned **only at `SCREEN`**, by a `CASE` inside the doorway — withholding is a
  database decision, not a UI one.
- The window is a **recurring wall clock**, not an instant — see [ADR-013](013-wall-clock-vs-instants.md).
- Self-scheduling still exists for interview slots. The two are different things and stay different.

## Implications for the product build

If a tenant ever asks for self-booked screening, **re-read the discarded analysis before designing
it again** — the unique-index trap is not obvious and costs a real bug. The partial-index form is
already written down.
