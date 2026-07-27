// Meeting vocabulary + input validation (M10). A meeting is a recurring WEEKLY template — a weekday
// + a wall-clock start/end — that employees log time against on their timesheet. Assignment-based
// like projects: a manager/HR creates a meeting and assigns employees; the assignment table (RLS'd)
// controls who may select it. Pure — no I/O. Reuses the HH:MM shape + duration math from shift/hours.
import { z } from "zod";
import { toShiftInstant } from "./shift";
import { hoursBetween } from "./hours";

export const MEETING_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

// 0 = Sunday … 6 = Saturday (JS Date.getUTCDay convention — matches how the grid resolves weekdays
// and how the seed stores dayOfWeek). Ordered Mon-first for display is a UI concern, not this tuple's.
export const DAYS_OF_WEEK = [0, 1, 2, 3, 4, 5, 6] as const;
export type DayOfWeek = (typeof DAYS_OF_WEEK)[number];

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// Create / edit a meeting. `dayOfWeek` is the weekday it recurs on; `startTime`/`endTime` are the
// wall-clock window (same-day only — overnight meetings are out of scope, like shifts).
export const meetingSchema = z
  .object({
    name: z.string().trim().min(1, "A meeting needs a name.").max(120),
    dayOfWeek: z.coerce.number().int().min(0, "Pick a weekday.").max(6, "Pick a weekday."),
    startTime: z.string().regex(HHMM, "Use a HH:MM time."),
    endTime: z.string().regex(HHMM, "Use a HH:MM time."),
  })
  // String compare of HH:MM is chronological within a day.
  .refine((v) => v.endTime > v.startTime, { message: "End time must be after the start time.", path: ["endTime"] });

export type MeetingInput = z.infer<typeof meetingSchema>;

// A meeting's duration in decimal hours (its suggested timesheet contribution), from its HH:MM window.
// Uses an arbitrary reference date since only the time-of-day delta matters. Returns 0 if end <= start.
export function meetingDurationHours(startTime: string, endTime: string): number {
  const day = "2000-01-01";
  return hoursBetween(toShiftInstant(day, startTime), toShiftInstant(day, endTime));
}
