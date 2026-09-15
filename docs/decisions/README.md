# Decision records

Why things are the way they are — including the options that were considered and **rejected**, which
is usually the part that stops a decision being quietly re-litigated.

Each record is *Context → Options → Decision → Consequences*, plus **Implications for the product
build** where the decision constrains the work ahead.

> These are **records, not rules**. A decision can be reversed — but reverse it knowingly, by editing
> the record and saying what changed, not by writing code that contradicts it.

## The set

| # | Decision | Status |
|---|----------|--------|
| [001](001-email-disabled-in-demos.md) | Email is disabled in the deployed demos | accepted |
| [002](002-demo-data-is-mutable.md) | Reviewers may mutate the demo data | accepted, demo-only |
| [003](003-neon-autosuspend-not-a-pinger.md) | Accept Neon cold starts; **never** run an uptime pinger | learned the hard way |
| [004](004-dynamic-routes-no-db-at-build.md) | Routes are dynamic; the build must not reach the database | accepted |
| [005](005-two-role-database-split.md) | `postgres` migrates, `hris_app` runs | accepted |
| [006](006-rls-is-the-primary-boundary.md) | Row authorization lives in the database, not the app | accepted |
| [007](007-storage-driver-seam.md) | Object storage behind a three-method driver seam | accepted |
| [008](008-domain-packages-mirror-enums.md) | Domain packages mirror Prisma enums rather than import them | accepted |
| [009](009-retention-is-a-privilege.md) | "Never hard-delete" is a privilege, not a convention | accepted |
| [010](010-no-applicant-self-booked-screening.md) | Recruiters phone candidates; no self-booked screening | accepted |
| [011](011-scope-loading-boundaries-with-route-groups.md) | Scope `loading.js` with a route group, never at the app root | from a production bug |
| [012](012-separate-applicant-auth-realm.md) | Applicants get their own auth realm | accepted |
| [013](013-wall-clock-vs-instants.md) | Wall clock for recurrence, instants for events | accepted |

## ⚠️ Read these before merging the apps into one

Four of these bind the integration directly, and breaking any of them is the kind of mistake that
looks like a simplification at the time:

| Read | Because |
|------|---------|
| **[006](006-rls-is-the-primary-boundary.md)** | A single merged app makes an app-layer guard look tidier — one middleware, one place. It is a downgrade. The merged app talks to the same database, and the policies are what make a forgotten `where` harmless. **Do not move authorization up.** |
| **[011](011-scope-loading-boundaries-with-route-groups.md)** | Merging `app/` trees is exactly how a root-level `loading.js` appears. In a merged app its blast radius is every route. Soft 404s are invisible in dev mode — **test against a production build.** |
| **[012](012-separate-applicant-auth-realm.md)** | Merge the three **staff** apps. Do **not** merge the portal into them. The realm split is a security property, not an artefact of separate deployments. |
| **[004](004-dynamic-routes-no-db-at-build.md)** | One merged app means one build. A single newly-static route reaching the database fails all of it. |

## And before adding a new app or feature

- **New table holding people-data?** RLS + policy **in the same migration** ([006](006-rls-is-the-primary-boundary.md)),
  and assess it for a DELETE revoke ([009](009-retention-is-a-privilege.md)).
- **New enum value in `schema.prisma`?** Grep the domain packages for the mirrored tuple — the
  compiler will not tell you ([008](008-domain-packages-mirror-enums.md)).
- **New database, anywhere?** Create `hris_app` **before** `migrate deploy` ([005](005-two-role-database-split.md)).
- **Storing time?** Decide wall clock vs instant before choosing the column type ([013](013-wall-clock-vs-instants.md)).
- **Anything applicant-facing?** It reads through a doorway keyed on the account, never an id from
  the caller ([portal-seam](../modules/portal-seam.md)).

## Adding a record

Next free number is **014**. Name it `NNN-short-kebab-summary.md`, add a row above, and link it from
whatever module doc or code comment it explains.

## See also

[`docs/modules/`](../modules/) — the seams: contracts spanning several files that none of them owns.
