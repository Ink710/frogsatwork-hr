// Time-off (PTO) domain vocabulary + input validation. Enum tuples mirror the Prisma enums in
// @hris/database (kept as local `as const` tuples so this package stays dependency-light, like
// @hris/types does for the employee schemas). Zod schemas validate form input at the server-action
// boundary; the parsed output carries real `Date`s.
import { z } from "zod";

export const LEAVE_TYPES = ["VACATION", "SICK", "PERSONAL", "UNPAID"] as const;
export const LEAVE_REQUEST_STATUSES = ["PENDING", "APPROVED", "DENIED", "CANCELLED"] as const;
export const LEDGER_SOURCES = ["OPENING", "ACCRUAL", "USAGE", "ADJUSTMENT", "REVERSAL"] as const;

export type LeaveType = (typeof LEAVE_TYPES)[number];
export type LeaveRequestStatus = (typeof LEAVE_REQUEST_STATUSES)[number];
export type LeaveLedgerSource = (typeof LEDGER_SOURCES)[number];

// A calendar date "YYYY-MM-DD" → a UTC-midnight Date. Stored/compared as UTC midnight so a
// negative-offset server timezone can never shift the day (same trick as @hris/types' dates).
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.")
  .transform((s) => new Date(`${s}T00:00:00.000Z`));

// Submit / edit a leave request. `employeeId` is present only when HR files on behalf of someone;
// the action re-checks that authority (RLS + isHrRole) — never trust the form for it.
export const leaveRequestSchema = z
  .object({
    type: z.enum(LEAVE_TYPES),
    startDate: calendarDate,
    endDate: calendarDate,
    hours: z.coerce
      .number()
      .positive("Hours must be greater than zero.")
      .max(2000, "That is more hours than a year of work."),
    reason: z.string().trim().max(500).optional(),
    employeeId: z.string().min(1).optional(),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: "The end date can't be before the start date.",
    path: ["endDate"],
  });

export type LeaveRequestInput = z.infer<typeof leaveRequestSchema>;

// Approve / deny a request: an optional note from the reviewer.
export const decisionSchema = z.object({
  decisionNote: z.string().trim().max(500).optional(),
});

export type DecisionInput = z.infer<typeof decisionSchema>;
