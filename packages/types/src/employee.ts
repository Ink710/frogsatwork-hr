// Zod validation shared by the Server Actions and the forms. Kept dependency-free of
// @hris/database (we hard-code the enum literals) so this package stays lightweight.
import { z } from "zod";

export const EMPLOYMENT_TYPES = ["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN"] as const;
// Profile-revamp enums (mirror the Prisma enums; hard-coded to keep this package DB-free).
export const FLSA_CLASSIFICATIONS = ["EXEMPT", "NON_EXEMPT"] as const;
export const PAY_FREQUENCIES = ["WEEKLY", "BIWEEKLY", "SEMI_MONTHLY", "MONTHLY"] as const;
export const PAY_BASES = ["PER_HOUR", "PER_MONTH", "PER_YEAR"] as const;

// Salary as a fixed-precision string (never a float) — Prisma Decimal accepts it verbatim.
const salaryString = z.string().regex(/^\d+(\.\d{1,2})?$/, "Enter an amount like 90000 or 90000.00");

// A "YYYY-MM-DD" calendar date → Date at local midnight, or absent. Used for review dates
// (which can be any past/future date, unlike futureOrToday). The caller passes `value || undefined`
// so an empty input is simply omitted.
const optionalCalendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid date")
  .transform((s) => new Date(`${s}T00:00:00`))
  .optional();

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
  // FLSA + pay frequency are versioned but NOT compensation-secret (any HR editor may set them).
  flsaClassification: z.enum(FLSA_CLASSIFICATIONS).optional(),
  payFrequency: z.enum(PAY_FREQUENCIES).optional(),
  salary: salaryString.optional(), // only honored for comp-editors; server enforces
  payBasis: z.enum(PAY_BASES).optional(), // pairs with salary → comp-editors only
  currency: z.string().length(3).optional(),
  effectiveFrom: futureOrToday,
  changeReason: z.string().max(500).optional(),
});

// ---- New-hire creation (mints the initial history version) ----
export const ASSIGNABLE_ROLES = ["EMPLOYEE", "MANAGER", "HR_GENERALIST", "HR_ADMIN", "PAYROLL_ADMIN"] as const;

export const employeeCreateSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  // Any date — this establishes the record (a hire can be backdated for existing staff).
  hireDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid date")
    .transform((s) => new Date(`${s}T00:00:00`)),
  departmentId: z.string().min(1),
  managerId: z.string().min(1).nullable().optional(),
  jobTitle: z.string().min(1),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  role: z.enum(ASSIGNABLE_ROLES).default("EMPLOYEE"),
  // Versioned classification (into the v1 history row).
  flsaClassification: z.enum(FLSA_CLASSIFICATIONS).optional(),
  payFrequency: z.enum(PAY_FREQUENCIES).optional(),
  salary: salaryString.optional(), // only honored for comp-editors
  payBasis: z.enum(PAY_BASES).optional(), // comp-editors only
  // Current-state descriptive fields (onto the Employee row). All optional at hire.
  phone: z.string().max(30).optional(),
  location: z.string().max(120).optional(),
  workSchedule: z.string().max(120).optional(),
  timeZone: z.string().max(60).optional(),
  // Comp-sensitive current-state (comp-editors only; server enforces).
  lastReviewDate: optionalCalendarDate,
  nextReviewDate: optionalCalendarDate,
  equityNote: z.string().max(200).optional(),
  // Every new hire starts with one emergency contact (the "at least one at all times"
  // invariant holds from day one). Created alongside the employee in the same transaction.
  emergencyContactName: z.string().min(1, "Emergency contact name is required").max(100),
  emergencyContactRelationship: z.string().min(1, "Relationship is required").max(60),
  emergencyContactPhone: z.string().min(1, "Contact phone is required").max(30),
});

// ---- Departments ----
// Shared by create and update. parent/head are optional (nullable → "none"); budget is an
// optional decimal string (same fixed-precision rule as salary). The parent cycle guard lives
// in the update action, not here (it needs the department tree). Empty strings are coerced to
// undefined/null by the action before parsing.
export const departmentSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  parentDepartmentId: z.string().min(1).nullable().optional(),
  headUserId: z.string().min(1).nullable().optional(),
  budget: z.string().regex(/^\d+(\.\d{1,2})?$/, "Enter an amount like 500000 or 500000.00").optional(),
});

// ---- Emergency contacts ----
export const emergencyContactSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  relationship: z.string().min(1, "Relationship is required").max(60),
  phone: z.string().min(1, "Phone is required").max(30),
  isPrimary: z.boolean().default(false),
});

// ---- Corrections (no new version) ----
// Current-state descriptive fields, correctable anytime (not a temporal event). Name/email are
// required; the rest are optional and the action only touches fields actually present in the form.
// Review dates + equity are comp-sensitive — the action ignores them unless the viewer is a
// comp-editor. (Formerly nameEmailCorrectionSchema, before the profile revamp added fields.)
export const detailsCorrectionSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().max(30).optional(),
  location: z.string().max(120).optional(),
  workSchedule: z.string().max(120).optional(),
  timeZone: z.string().max(60).optional(),
  lastReviewDate: optionalCalendarDate,
  nextReviewDate: optionalCalendarDate,
  equityNote: z.string().max(200).optional(),
});

// Material fields amended in place, only within the grace window. All optional; the action
// applies whichever are present. Includes the versioned classification fields.
export const materialCorrectionSchema = z.object({
  jobTitle: z.string().min(1).optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  departmentId: z.string().min(1).optional(),
  managerId: z.string().min(1).nullable().optional(),
  flsaClassification: z.enum(FLSA_CLASSIFICATIONS).optional(),
  payFrequency: z.enum(PAY_FREQUENCIES).optional(),
  salary: salaryString.optional(),
  payBasis: z.enum(PAY_BASES).optional(),
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

// ---- Leave / suspension (reversible status changes) ----
export const STATUS_CHANGE_TYPES = ["LEAVE", "SUSPENSION"] as const;

// Start a leave or suspension. expectedEnd is optional (a suspension is often open-ended);
// when given it must land on/after the start date. Both dates arrive as Date after transform,
// so the refine compares Dates.
export const startStatusChangeSchema = z
  .object({
    type: z.enum(STATUS_CHANGE_TYPES),
    reason: z.string().min(1).max(500),
    startDate: futureOrToday,
    expectedEnd: futureOrToday.optional(),
  })
  .refine((d) => !d.expectedEnd || d.expectedEnd >= d.startDate, {
    message: "Expected return can't be before the start date",
    path: ["expectedEnd"],
  });

// End the current leave/suspension (return to active).
export const reinstateSchema = z.object({
  returnDate: futureOrToday,
});

// ---- Documents ----
export const DOCUMENT_TYPES = ["CONTRACT", "IDENTIFICATION", "CERTIFICATION", "PERFORMANCE", "OTHER"] as const;

export const documentUploadSchema = z.object({
  documentType: z.enum(DOCUMENT_TYPES),
  // Optional expiry (e.g. a certification). The file itself is validated in the action.
  expiresAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .transform((s) => new Date(`${s}T00:00:00`))
    .optional(),
});

// ---- New-hire set-password (invite redemption) ----
// .refine reports the mismatch on the `confirm` field so the form can show it inline.
export const setPasswordSchema = z
  .object({
    password: z.string().min(8, "Use at least 8 characters"),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    message: "Passwords don't match",
    path: ["confirm"],
  });

// ---- Correction grace window ----
export const CORRECTION_WINDOW_DAYS = 7;

// Pure predicate: is a history row still young enough to correct in place?
export function isWithinCorrectionWindow(createdAt: Date | string | number) {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  return ageMs <= CORRECTION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

// ---------------------------------------------------------------------------
// Static types derived from the runtime schemas above.
//
// These are the payoff of adopting TypeScript here: instead of hand-writing (and
// separately maintaining) type declarations, we DERIVE them from the single
// source of truth — the Zod schemas and enum tuples. The validator and the
// compile-time type can never drift apart, because one is generated from the other.
// ---------------------------------------------------------------------------

// `(typeof TUPLE)[number]` = the union of a readonly tuple's element types.
// e.g. EmploymentType = "FULL_TIME" | "PART_TIME" | "CONTRACT" | "INTERN".
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export type FlsaClassification = (typeof FLSA_CLASSIFICATIONS)[number];
export type PayFrequency = (typeof PAY_FREQUENCIES)[number];
export type PayBasis = (typeof PAY_BASES)[number];
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];
export type StatusChangeType = (typeof STATUS_CHANGE_TYPES)[number];
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

// `z.infer<typeof schema>` = the OUTPUT type a schema produces after parsing.
// Because several schemas `.transform()` date strings into Date objects, these
// types reflect the POST-parse shape a Server Action receives from `.parse()`
// (e.g. `effectiveFrom` is a `Date`, not the "YYYY-MM-DD" string that came in).
export type EmployeeChangeInput = z.infer<typeof employeeChangeSchema>;
export type EmployeeCreateInput = z.infer<typeof employeeCreateSchema>;
export type DepartmentInput = z.infer<typeof departmentSchema>;
export type EmergencyContactInput = z.infer<typeof emergencyContactSchema>;
export type DetailsCorrectionInput = z.infer<typeof detailsCorrectionSchema>;
export type MaterialCorrectionInput = z.infer<typeof materialCorrectionSchema>;
export type TerminationInput = z.infer<typeof terminationSchema>;
export type RehireInput = z.infer<typeof rehireSchema>;
export type StartStatusChangeInput = z.infer<typeof startStatusChangeSchema>;
export type ReinstateInput = z.infer<typeof reinstateSchema>;
export type DocumentUploadInput = z.infer<typeof documentUploadSchema>;
export type SetPasswordInput = z.infer<typeof setPasswordSchema>;
