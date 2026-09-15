# ADR-004 — Routes are dynamic; the build must not reach the database

**Status:** accepted · **Date:** 2026-08 · **Applies to:** all apps

## Context

Next.js prerenders routes at build time where it can. Every meaningful route in this suite reads
`cookies()` for the session, so it is dynamic by nature — but a route that *looks* static can be
prerendered, and prerendering runs queries during `next build`, when no application database
connection should be assumed.

## Decision

Routes are **dynamic**. The build does not connect to Postgres. If a build ever fails trying to reach
the database, mark the offending route:

```js
export const dynamic = "force-dynamic";
```

## Consequences

- No build-time database dependency: CI and Vercel builds succeed with no `DATABASE_URL` reachable.
- No static caching of user data — correct here, since almost every page is viewer-scoped by RLS.
- A genuinely public, cacheable page (the careers listing) is still rendered per request. Accepted:
  the doorway query is cheap and correctness beats a cache we would have to invalidate.

## Implications for the product build

When merging the apps, **check this per route, not per app.** A merged app has one build; a single
newly-static route reaching the database fails the whole build. If public marketing pages are added
to the same app, they are the routes most likely to be statically optimised — give them their own
data path that does not touch tenant data.
