# The notification seam — sending email exactly once

> **Covers:** `packages/notifications/src/transport.js` · `deliver.js` · `templates.js` ·
> `app_claim_notification` / `app_mark_notification` · the `NotificationDelivery` unique index
> **Anchors:** `apps/ats/tests/notifications.itest.js` ·
> `packages/notifications/src/templates.test.js` · `test/mailbox.js`
> **Lies if:** the `NULLS NOT DISTINCT` index is rebuilt without that clause, or a caller sends mail
> without claiming first.
> **Last verified:** 2026-09-12

Three separate problems, solved in three separate places: **who to tell** (SQL), **what to say**
(templates), **how to send** (transport). The seam is the claim-then-send protocol that joins them.

---

## The layers

| Layer | File | Owns |
|-------|------|------|
| Transport | `transport.js` | one lazily-created nodemailer transport, `sendMail`, `DEFAULT_FROM` |
| Templates | `templates.js` | `candidateStageEmail`, `interviewerSlotEmail`, `NOTIFICATION_LOCALES` |
| Delivery | `deliver.js` | claim → render → send → mark |
| Ledger | `NotificationDelivery` + two `app_*` functions | the once-only guarantee |

> **This package owns the transport; each app owns the words it sends.** Copy is product surface and
> belongs next to the feature that needs it — except candidate-facing copy, which is here precisely
> because two apps must say the same thing.

---

## ⚠️ `NULLS NOT DISTINCT` is the whole mechanism

The once-only guarantee is a **unique index**, and it only works because of one clause:

```sql
CREATE UNIQUE INDEX "NotificationDelivery_event_channel_recipient_key"
  ON "NotificationDelivery" ("applicationEventId", "channel", "recipientUserId") NULLS NOT DISTINCT;
```

**In Postgres, NULLs in a unique index are DISTINCT by default.** Every candidate notification has
`recipientUserId IS NULL` — the recipient is the candidate on the event, not a `User`. So with the
default behaviour:

- two claims for the same event would **not** collide
- `ON CONFLICT DO NOTHING` would never fire
- every claim would succeed
- a retry or a double-submit would send the same person the same email twice

**And nothing would error. Nothing would look wrong.** The failure is invisible in logs, in tests
that assert "it sent", and in the database — you would only find it in someone's inbox.

> Requires **PG 15+**. Dev is 16.14 and Neon is 16+, both verified. Prisma cannot express this
> clause, so it is declared in raw SQL and `schema.prisma` deliberately does **not** declare a
> `@@unique` it would get wrong — a silent downgrade to the default behaviour is exactly the bug.

The same trick pins one-slot-per-round on `InterviewSlot`. When you see a nullable column inside a
unique index anywhere in this schema, check for the clause before assuming the constraint holds.

---

## The claim-then-send protocol

```js
app_claim_notification(eventId, 'EMAIL', recipient, slotId)   // → claimed? true/false
   ↓ only if true
render template → sendMail(...)
   ↓
app_mark_notification(eventId, 'EMAIL', status, recipient, slotId)
```

**Claim before sending, not after.** The claim is the atomic act: it inserts the ledger row with
`ON CONFLICT DO NOTHING` and reports whether *this* caller won. Two concurrent attempts — a retry, a
double-submitted form, two serverless invocations — produce exactly one `true`.

The mark afterwards records the outcome. A crash between send and mark leaves a claimed-but-unmarked
row: the email went out and is recorded as claimed, so **it will not be sent twice**. That is the
right way round — the failure mode is an imperfect audit trail, not a duplicate in someone's inbox.

---

## ⚠️ The transport lives in its own module — and the bug that put it there

`transport.js` exists as a separate file for one reason, and it is a testing trap worth
understanding before you "tidy" it back.

It used to sit in `index.js`, with `deliver.js` importing `sendMail` from `"./index.js"`. A test
mocking the **package** (`"@hris/notifications"`) then had no effect: **Vitest treats the bare
specifier and the relative `"./index.js"` as different modules.** The delivery helper kept calling
the real nodemailer while the stub sat unused — *the suite passed while quietly trying to reach
SMTP.*

Splitting it out gives every internal caller one module to import and tests one module to replace.
The public surface is unchanged; `index.js` re-exports it.

> **The general lesson:** a green test that mocks a package is only meaningful if the code under test
> imports that package by the same specifier the mock uses. Check this whenever a mock seems to have
> no effect.

In dev, `SMTP_HOST` points at the **Mailpit** container (SMTP `:1025`, inbox at
`http://localhost:8025`); in production the same variables point at a real provider, so no code
changes. `test/mailbox.js` is the test-side counterpart.

---

## `sendMail` throws, deliberately

It does **not** swallow failures.

> Callers decide what a failure means — for a login link it must **not** become a signal to the user
> (saying "we couldn't send that" reveals the address exists), but a caller can only make that choice
> if it hears about the failure at all. A tidy `catch` here would recreate the blind spot that left
> the platform logs empty during a real outage.

### `replyTo` matters more than it looks

Everything is sent from `no-reply@`. Until `replyTo` existed, a candidate told to "contact the person
following up" had nowhere to write — replying to our own notification bounced.

- **Writing to a candidate?** Pass the recruiting address.
- **Staff mail** (an invite, a slot confirmation)? None needed — those people can already reach us.

`RECRUITING_REPLY_TO` is deliberately a **role address**, not a named person: it survives someone
leaving and publishes no personal staff address to strangers. Unset is a valid configuration; the
header is simply omitted.

---

## Working on this safely

- **Always claim before sending.** A `sendMail` with no claim in front of it is a duplicate waiting
  for a retry.
- **Never rebuild the unique index without `NULLS NOT DISTINCT`**, and never let Prisma generate it.
- **Adding a template?** Put candidate-facing copy here (two apps read it) and staff-facing copy in
  the app's own `lib/messages/`.
- **Mocking this package in a test?** Mock `transport.js`, and check the specifier matches.

## Read next

- [portal-seam.md](portal-seam.md) — `portalUrl()`, and why candidate mail must not link to the ATS
- [ADR-001](../decisions/001-email-disabled-in-demos.md) — why the demos send nothing
