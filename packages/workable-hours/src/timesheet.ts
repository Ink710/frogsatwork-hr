// Timesheet vocabulary + input validation. Enum tuple mirrors the Prisma `TimesheetStatus`.
import { z } from "zod";

export const TIMESHEET_STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"] as const;
export type TimesheetStatus = (typeof TIMESHEET_STATUSES)[number];

// One day's worked hours. `hours` may be 0 (an empty day) — the save action drops 0-hour rows so
// nothing is stored for days not worked. Dates stay as "YYYY-MM-DD" strings; the action converts.
export const timeEntrySchema = z.object({
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date."),
  hours: z.coerce.number().min(0, "Hours can't be negative.").max(24, "A day can't exceed 24 hours."),
  project: z.string().trim().max(120).optional(),
  note: z.string().trim().max(300).optional(),
});

// The whole week's rows, submitted together from the grid (as a JSON blob).
export const timesheetEntriesSchema = z.array(timeEntrySchema).max(31);

export type TimeEntryInput = z.infer<typeof timeEntrySchema>;
