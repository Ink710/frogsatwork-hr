// Interview slots (M9): the derived lifecycle, the time arithmetic, and the shape of a proposal.
//
// Pure and zod-only, like everything else in this package, so the rules are testable without a
// database and identical in every app that renders them.
import { z } from "zod";

// ── The lifecycle ────────────────────────────────────────────────────────────────────────────
//
// Stored as four nullable timestamps, not a status column: every step reverses by setting NULL, and
// WHEN each happened survives. The status is DERIVED here so there is exactly one definition of it.
export const SLOT_STATUSES = ["CANCELLED", "CLAIMED", "PUBLISHED", "CONFIRMED", "PROPOSED"] as const;
export type SlotStatus = (typeof SLOT_STATUSES)[number];

export interface SlotTimestamps {
  confirmedAt?: Date | string | null;
  publishedAt?: Date | string | null;
  claimedAt?: Date | string | null;
  cancelledAt?: Date | string | null;
}

/**
 * ⚠️ ORDER MATTERS AND IT IS NOT THE LIFECYCLE ORDER. Cancellation is checked FIRST because it can
 * happen from any state — a cancelled slot that was already claimed is cancelled, not claimed, and
 * showing "claimed" for it would tell a recruiter someone is still coming.
 */
export function slotStatus(slot: SlotTimestamps): SlotStatus {
  if (slot.cancelledAt) return "CANCELLED";
  if (slot.claimedAt) return "CLAIMED";
  if (slot.publishedAt) return "PUBLISHED";
  if (slot.confirmedAt) return "CONFIRMED";
  return "PROPOSED";
}

/** The assigned interviewer may confirm while it is neither confirmed nor cancelled. */
export function canConfirm(slot: SlotTimestamps): boolean {
  return !slot.cancelledAt && !slot.confirmedAt;
}

/**
 * ⚠️ PUBLISHING REQUIRES CONFIRMATION — this predicate IS the two-person rule. Without it a recruiter
 * could offer a candidate a time nobody has agreed to sit in. The database allows the write (a
 * recruiter may manage the row); this is where the workflow says no.
 */
export function canPublish(slot: SlotTimestamps): boolean {
  return !slot.cancelledAt && !!slot.confirmedAt && !slot.publishedAt;
}

/** Anything not already cancelled can be cancelled, including a claimed slot (plans change). */
export function canCancel(slot: SlotTimestamps): boolean {
  return !slot.cancelledAt;
}

/** Only a published, unclaimed, uncancelled slot can be taken. Mirrors app_claim_interview_slot. */
export function isClaimable(slot: SlotTimestamps): boolean {
  return !slot.cancelledAt && !slot.claimedAt && !!slot.publishedAt;
}

/**
 * THE ONCE-ONLY RULE (M11), as a predicate.
 *
 * A candidate may choose a time for a round exactly once. There is no self-service reschedule: a
 * second attempt is refused and told to contact whoever is following up on their process.
 *
 * ⚠️ THIS IS THE UI's COPY OF A RULE THE DATABASE ENFORCES, never the enforcement itself. The unique
 * index on ("claimedByApplicationId", "roundId") is what makes it true, and
 * app_applicant_claim_slot answers ALREADY_BOOKED regardless of what any page decided to render.
 * The predicate exists so the portal can show the rule BEFORE someone runs into it — the refusal is
 * a worse way to learn it than a sentence next to their booked time.
 */
export function canSelfSchedule({ booked }: { booked: boolean }): boolean {
  return !booked;
}

// ── Wall clock in a named zone → an absolute instant ─────────────────────────────────────────

const WALL_CLOCK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

// What a given instant reads as on a clock in `timeZone`, as an ISO-ish wall-clock string.
function wallClockIn(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  // `hourCycle` quirk: some environments render midnight as "24".
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}:${get("second")}`;
}

/**
 * Turn "2026-03-03T15:00" *as read on a clock in `timeZone`* into the UTC instant it denotes.
 *
 * ⚠️ THIS IS THE PIECE THE WHOLE TIMEZONE DECISION RESTS ON, and the obvious version is wrong.
 * `new Date("2026-03-03T15:00")` uses the SERVER's zone, so a recruiter in Mexico City proposing
 * 15:00 would have it stored as 15:00 UTC — nine hours out — and nothing would look broken until a
 * candidate showed up at the wrong time.
 *
 * The method: guess that the wall clock is UTC, ask what that instant actually reads as in the
 * target zone, and shift by the difference. **Twice** — because if the first shift crosses a DST
 * boundary the offset it used is the wrong one, and the second pass lands on the right side. A third
 * pass would never change anything, since two passes always converge outside the one ambiguous hour
 * of a fall-back transition.
 *
 * No dependency: Intl knows the whole tz database, and this package stays zod-only.
 */
export function zonedWallClockToUtc(wall: string, timeZone: string): Date {
  if (!WALL_CLOCK.test(wall)) throw new Error(`Expected YYYY-MM-DDTHH:mm, got "${wall}"`);
  const target = Date.parse(`${wall}:00Z`);

  let guess = new Date(target);
  for (let pass = 0; pass < 2; pass++) {
    const shown = Date.parse(`${wallClockIn(guess, timeZone)}Z`);
    guess = new Date(guess.getTime() + (target - shown));
  }
  return guess;
}

/** The inverse, for prefilling a form: the wall clock this instant reads as in `timeZone`. */
export function utcToZonedWallClock(instant: Date | string, timeZone: string): string {
  return wallClockIn(new Date(instant), timeZone).slice(0, 16);
}

// ── Rendering ────────────────────────────────────────────────────────────────────────────────

/**
 * The CANONICAL rendering: "Tue, 3 Mar 2026, 15:00–16:00 (America/Mexico_City)".
 *
 * ⚠️ THE ZONE IS ALWAYS NAMED, and that is the point rather than a nicety. This string goes into
 * server-rendered pages and into EMAIL, neither of which has a browser to localise anything, and it
 * is read by a candidate whose own zone we do not know. "15:00" alone is not a time — it is a number
 * that means something different to each reader. Apps may ADD a local-time line on top of this
 * client-side; they must not replace it.
 */
export function formatSlotWhen(
  slot: { startAt: Date | string; endAt: Date | string; timeZone: string },
  locale = "en",
): string {
  const start = new Date(slot.startAt);
  const end = new Date(slot.endAt);
  const day = new Intl.DateTimeFormat(locale, {
    timeZone: slot.timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(start);
  const time = (d: Date) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: slot.timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
  return `${day}, ${time(start)}–${time(end)} (${slot.timeZone})`;
}

// ── What a recruiter submits ─────────────────────────────────────────────────────────────────

export const SLOT_DURATIONS = [15, 30, 45, 60, 90, 120] as const;

export const interviewSlotSchema = z.object({
  roundId: z.string().min(1, "Choose an interview round."),
  interviewerEmployeeId: z.string().min(1, "Choose an interviewer."),
  // Wall clock as the browser's datetime-local input produces it. Converted with the zone below —
  // never with `new Date()`, which would silently use the server's zone.
  startsAt: z.string().regex(WALL_CLOCK, "Choose a date and time."),
  timeZone: z.string().min(1, "Choose a time zone."),
  durationMinutes: z.coerce
    .number()
    .int()
    .refine((n) => (SLOT_DURATIONS as readonly number[]).includes(n), "Choose a duration."),
  // Optional: plenty of interviews are a phone call arranged separately. An empty string is the
  // ordinary state of an untouched input, so it is accepted and normalised away by the caller.
  meetingUrl: z.union([z.string().trim().url("Enter a valid link.").max(500), z.literal("")]).optional(),
});
export type InterviewSlotInput = z.infer<typeof interviewSlotSchema>;
