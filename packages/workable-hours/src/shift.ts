// Scheduling vocabulary + input validation. Shift times are a date + wall-clock start/end within
// a single day, stored as UTC instants (real per-location timezones are deferred).
import { z } from "zod";

export const SHIFT_SWAP_STATUSES = ["PENDING", "APPROVED", "DENIED", "CANCELLED"] as const;
export type ShiftSwapStatus = (typeof SHIFT_SWAP_STATUSES)[number];

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// Create / edit a shift. `employeeId` absent = an OPEN (unassigned) shift.
export const shiftSchema = z
  .object({
    employeeId: z.string().min(1).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date."),
    start: z.string().regex(HHMM, "Use a HH:MM time."),
    end: z.string().regex(HHMM, "Use a HH:MM time."),
    role: z.string().trim().max(80).optional(),
    note: z.string().trim().max(300).optional(),
  })
  // Same-day shifts: string compare of HH:MM is chronological. (Overnight shifts are out of scope.)
  .refine((v) => v.end > v.start, { message: "End time must be after the start time.", path: ["end"] });

// An employee's drop/swap request on their own shift. `targetEmployeeId` absent = drop-to-open.
export const shiftSwapSchema = z.object({
  shiftId: z.string().min(1),
  targetEmployeeId: z.string().min(1).optional(),
  reason: z.string().trim().max(500).optional(),
});

// Create MANY shifts at once (batch): every selected employee × every selected day gets a shift with
// the same start/end/role/note. `open` adds an unassigned (open) shift for each day too. At least one
// assignee (an employee or `open`) and one day are required.
export const batchShiftSchema = z
  .object({
    employeeIds: z.array(z.string().min(1)).default([]),
    open: z.coerce.boolean().default(false),
    days: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.")).min(1, "Pick at least one day."),
    start: z.string().regex(HHMM, "Use a HH:MM time."),
    end: z.string().regex(HHMM, "Use a HH:MM time."),
    role: z.string().trim().max(80).optional(),
    note: z.string().trim().max(300).optional(),
  })
  .refine((v) => v.end > v.start, { message: "End time must be after the start time.", path: ["end"] })
  .refine((v) => v.employeeIds.length > 0 || v.open, { message: "Pick at least one employee, or an open shift.", path: ["employeeIds"] });

export type ShiftInput = z.infer<typeof shiftSchema>;
export type ShiftSwapInput = z.infer<typeof shiftSwapSchema>;
export type BatchShiftInput = z.infer<typeof batchShiftSchema>;

// How far a timezone's wall-clock sits from UTC at a given instant, in milliseconds (negative for
// zones behind UTC, e.g. −6h for America/Mexico_City). Uses Intl to read the zone's wall-clock for
// the instant and diffs it against UTC — the standard no-dependency way to get a real, DST-aware offset.
function zoneOffsetMs(utcInstant: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(utcInstant)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const wallAsUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return wallAsUtc - utcInstant.getTime();
}

// Interpret a calendar date + wall-clock time AS wall-clock in `timeZone`, and return the true UTC
// instant it corresponds to. e.g. ("2026-07-20","09:00","America/Mexico_City") → 15:00Z. With the
// default "UTC" it equals the old fake-UTC behavior (09:00 → 09:00Z), so existing callers/tests are
// unchanged. One offset correction is exact except within the ~1h DST-transition window (acceptable).
export function zonedWallClockToUtc(date: string, time: string, timeZone = "UTC"): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  // First correction using the offset at the guess, then a second pass using the offset at the
  // computed instant — this makes it exact across DST transitions (where those two offsets differ).
  let result = guess - zoneOffsetMs(new Date(guess), timeZone);
  result = guess - zoneOffsetMs(new Date(result), timeZone);
  return new Date(result);
}

// Back-compat alias: a UTC-framed wall-clock instant (used by tz-independent duration math, e.g.
// meetingDurationHours). New code should pass an explicit timezone via zonedWallClockToUtc.
export function toShiftInstant(date: string, time: string): Date {
  return zonedWallClockToUtc(date, time, "UTC");
}

// The "HH:MM" wall-clock label of a stored UTC instant, rendered in `timeZone` (default "UTC" keeps
// the old behavior). This is how a true-UTC punch/shift instant is shown in the viewer's local time.
export function shiftTimeLabel(instant: Date | string | number, timeZone = "UTC"): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(instant));
}

// The local CALENDAR date ("YYYY-MM-DD") of a true-UTC instant in `timeZone` — i.e. which day a punch
// or shift belongs to for the viewer. en-CA formats as YYYY-MM-DD. Default "UTC" = the old dayKey.
// This is what makes "today"/"this week" and day-grouping follow the viewer's clock, not UTC.
export function dayKeyInZone(instant: Date | string | number, timeZone = "UTC"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instant));
}
