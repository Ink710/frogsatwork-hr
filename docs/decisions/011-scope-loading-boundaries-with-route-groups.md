# ADR-011 — A `loading.js` must be scoped by a route group, never placed at the app root

**Status:** accepted, **learned from a production bug** · **Date:** 2026-08-31 (M15) · **Applies to:** all apps

## Context

M14 added a root `app/loading.js` to the candidate portal for a nicer first paint. After deploy,
**`/jobs/bogus` returned HTTP 200** instead of 404 — a soft 404: the correct not-found page rendered,
with a success status.

## The mechanism

A `loading.js` creates a Suspense boundary. Next.js **flushes the HTTP response headers when the
boundary renders** — before the page beneath it has resolved. By the time `notFound()` runs, the
status line is already sent and can no longer be changed.

A root `loading.js` wraps **every route in the app**, so every bad URL became a soft 404.

## ⚠️ Two wrong diagnoses first — worth knowing

1. Blamed `app/jobs/[id]/loading.js`. A production-build A/B showed 200 **either way**.
2. Tested in dev mode — **proved nothing**: dev soft-404s regardless, so the A/B could not
   distinguish. Only a production build can reproduce this.

The real culprit was the root boundary, found only by removing *both* files.

## Decision

Scope loading boundaries with a **route group**:

```
app/(browse)/loading.js    ← covers the browse pages only
app/(browse)/page.js
app/jobs/[id]/page.js      ← outside the group; notFound() sets a real 404
```

Parentheses organise files without appearing in the URL, so no route changes.

## Consequences

- Skeletons are kept **and** `/jobs/bogus` returns a real 404.
- Any route that can `notFound()` must not sit under a loading boundary.
- Verified in production: `/jobs/bogus` → 404.

## Implications for the product build

**This is a merge hazard.** Combining apps means combining `app/` trees, and a root-level
`loading.js`, `error.js` or `template.js` in a merged app has a far wider blast radius than it did in
a small one.

When merging: put *no* boundary at the root, give each merged area its own route group, and **test
404s against a production build** — a dev-mode check cannot see this class of bug.
