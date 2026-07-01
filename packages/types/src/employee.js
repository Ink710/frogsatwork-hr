// Zod validation shared by the Server Actions and the forms. Kept dependency-free of
// @hris/database (we hard-code the enum literals) so this package stays lightweight.
import { z } from "zod";

export const EMPLOYMENT_TYPES = ["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN"];

// Salary as a fixed-precision string (never a float) — Prisma Decimal accepts it verbatim.
const salaryString = z.string().regex(/^\d+(\.\d{1,2})?$/, "Enter an amount like 90000 or 90000.00");

// Date inputs arrive as "YYYY-MM-DD" (an <input type="date">). We validate and compare
// them as CALENDAR-DATE STRINGS to avoid the classic timezone trap (parsing the string as
// UTC midnight then comparing to a local clock shifts "today" across the date line).
// en-CA locale renders local dates as YYYY-MM-DD, so lexical >= is a correct date compare.
const localTodayStr = () => new Date().toLocaleDateString("en-CA");

const futureOrToday = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid date")
  .refine((s) => s >= localTodayStr(), "Date can't be in the past")
  .transform((s) => new Date(`${s}T00:00:00`)); // interpret as LOCAL midnight

// ---- Effective-dated change (creates a new history version) ----
export const employeeChangeSchema = z.object({
  jobTitle: z.string().min(1),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  departmentId: z.string().min(1),
  managerId: z.string().min(1).nullable().optional(),
  salary: salaryString.optional(), // only honored for comp-editors; server enforces
  currency: z.string().length(3).optional(),
  effectiveFrom: futureOrToday,
  changeReason: z.string().max(500).optional(),
});

// ---- Corrections (no new version) ----
export const nameEmailCorrectionSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
});

// Material fields amended in place, only within the grace window. All optional; the action
// applies whichever are present.
export const materialCorrectionSchema = z.object({
  jobTitle: z.string().min(1).optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  departmentId: z.string().min(1).optional(),
  managerId: z.string().min(1).nullable().optional(),
  salary: salaryString.optional(),
  changeReason: z.string().max(500).optional(),
});

// ---- Lifecycle ----
export const terminationSchema = z.object({
  terminationDate: futureOrToday,
  terminationReason: z.string().min(1).max(500),
  eligibleForRehire: z.boolean(),
});

export const rehireSchema = z.object({
  rehireDate: futureOrToday,
});

// ---- Correction grace window ----
export const CORRECTION_WINDOW_DAYS = 7;

// Pure predicate: is a history row still young enough to correct in place?
export function isWithinCorrectionWindow(createdAt) {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  return ageMs <= CORRECTION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}
