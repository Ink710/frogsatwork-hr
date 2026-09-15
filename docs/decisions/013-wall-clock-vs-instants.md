# ADR-013 — Wall-clock times for recurrence, absolute instants for events

**Status:** accepted · **Date:** 2026-08-29 · **Applies to:** `Meeting`, `Shift`, `InterviewSlot`, the screening window

## Context

The suite stores two genuinely different kinds of time, and using one representation for both is
wrong in one direction or the other.

## Decision

| Kind | Stored as | Used by | Why |
|---|---|---|---|
| **Recurring wall clock** | `"HH:MM"` + an IANA zone | `Meeting`, the screening-call window | The event has no date. "Every Tuesday at 09:00" stays 09:00 across a clock change — that is what people mean. |
| **Absolute instant** | `timestamp` | `Shift`, `InterviewSlot` | The event happens once, at one moment. Everyone involved must agree on that moment regardless of where they are. |

A timestamp for a recurring window would have to **invent a date**. A wall clock for a one-off
interview would be **ambiguous across zones**.

## ⚠️ The screening window is never converted to the viewer's local time

Unlike interview slots, which *are* converted. Converting a wall clock needs a **date** to pick an
offset from, and a recurring window has none — anchoring on "today" would state the wrong hour for a
call that happens after a clock change.

> A labelled canonical time is always right. A helpfully converted one can be wrong on the one day it
> matters, and the cost of that is a missed phone call.

So the zone is **always named**: `09:00–17:00 (America/Mexico_City)`. "Between 9 and 5" is
meaningless to a candidate in another country.

## The formatting trick

`formatCallWindow` places the hours on a **fixed UTC date** and reads them back **in UTC**, so the
locale decides 24-hour vs am/pm styling while no zone conversion can occur:

```ts
new Intl.DateTimeFormat(locale, { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hour12: false })
  .format(new Date(Date.UTC(2000, 0, 1, h, m)));
```

It deliberately matches `formatSlotWhen`'s 24-hour style, so the two do not read as different
systems on the same page.

## Implications for the product build

Ask which kind of time a new feature needs **before** choosing a column type; retrofitting is a data
migration, not a refactor. Anything applicant-facing must name its zone — that is the one
applicant-facing time rule this suite has.
