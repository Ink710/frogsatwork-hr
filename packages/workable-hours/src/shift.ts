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

export type ShiftInput = z.infer<typeof shiftSchema>;
export type ShiftSwapInput = z.infer<typeof shiftSwapSchema>;

// Combine a calendar date + a wall-clock time into a UTC instant (how shift start/end are stored).
export function toShiftInstant(date: string, time: string): Date {
  return new Date(`${date}T${time}:00.000Z`);
}

// The "HH:MM" wall-clock label of a stored shift instant (UTC components, matching how it was saved).
export function shiftTimeLabel(instant: Date | string | number): string {
  const d = new Date(instant);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
