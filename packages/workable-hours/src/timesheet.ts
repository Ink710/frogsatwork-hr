// Timesheet vocabulary + input validation. Enum tuple mirrors the Prisma `TimesheetStatus`.
import { z } from "zod";

export const TIMESHEET_STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"] as const;
export type TimesheetStatus = (typeof TIMESHEET_STATUSES)[number];

// One line of worked hours. `hours` may be 0 (an empty line) — the save action drops 0-hour rows so
// nothing is stored for time not worked. Dates stay as "YYYY-MM-DD" strings; the action converts.
// A line may be tagged with a project OR a meeting OR neither — never both (a line is one activity).
export const timeEntrySchema = z
  .object({
    workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date."),
    hours: z.coerce.number().min(0, "Hours can't be negative.").max(24, "A day can't exceed 24 hours."),
    // A project the employee is assigned to (M8). Absent = untagged time. The save action validates the
    // id belongs to the employee's assignments before persisting.
    projectId: z.string().min(1).optional(),
    // A recurring meeting the employee is assigned to (M10). Same validation contract as projectId.
    meetingId: z.string().min(1).optional(),
    note: z.string().trim().max(300).optional(),
  })
  .refine((e) => !(e.projectId && e.meetingId), {
    message: "A line can be tagged to a project or a meeting, not both.",
    path: ["meetingId"],
  });

// The whole week's rows, submitted together from the grid (as a JSON blob). A day can hold several
// line-items now (project work + a meeting), so the cap is higher than the old one-row-per-day 31.
export const timesheetEntriesSchema = z.array(timeEntrySchema).max(70);

export type TimeEntryInput = z.infer<typeof timeEntrySchema>;
