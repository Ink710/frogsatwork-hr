# ADR-007 — Object storage behind a three-method driver seam

**Status:** accepted · **Date:** 2026-08 · **Applies to:** `employee-records`, `ats`, `candidate-portal`

## Context

Two apps store binaries (employee documents, candidate résumés). The local filesystem is ideal for
development and tests and **does not work on serverless hosting**, where the filesystem is ephemeral
and read-only. Object storage costs money and the account belongs to whoever runs the app.

## Options

1. **Call the provider SDK directly** — fewest moving parts, and every call site is a migration cost
   when the provider changes.
2. **A driver seam** — `put` / `getStream` / `remove`, provider chosen by `STORAGE_DRIVER`.
3. A general filesystem abstraction library.

## Decision

**Option 2.** `createStorage()` returns a driver. `local` and `vercel-blob` are implemented;
`s3` and `r2` are **declared and throw** a clear, actionable error.

The interface is three methods and should stay three. Every method added is a method every future
driver must implement.

## Consequences

- Swapping providers is **one file, no calling-code changes**.
- The "declared but throwing" drivers advertise the intended shape without pretending to work —
  honest rather than untidy.
- ⚠️ `STORAGE_DRIVER` unset defaults to `local`. In production, uploads then **succeed** onto an
  ephemeral disk and vanish. Nothing errors. This is the worst failure mode in the suite.
- The seam does **no authorization** — that is RLS plus a signed link in front of the route.
- **Known gap:** that erasure removes a candidate's blob from the object store has not been verified
  end to end against a real Blob store.

## Implications for the product build

This ADR is what makes the provider choice reversible — the Vercel-native vs portable-R2 question
does not have to be settled before launch, and settling it wrongly is not fatal.

Two things it does **not** cover, both needed before selling:

1. **Migrating existing files.** Changing the driver changes where *new* bytes go. Anything already
   written stays put. Plan a copy.
2. **Verifying erasure deletes the blob.** Under GDPR this stops being a nice-to-have the moment
   money changes hands — it becomes a representation made to a data subject.
