// The richer application an applicant submits (M6): work history, education, and consent.
import { z } from "zod";
import { publicApplicationSchema } from "./candidate";

// ⚠️ THE POLICY VERSION LIVES IN CODE, NOT IN A DATABASE ROW.
//
// It identifies the TEXT someone agreed to, and that text ships with the app. Keeping it in a table
// would let the version change without the wording changing (or worse, the wording change without
// the version), which would make every stored consent record unverifiable. Bump this whenever the
// privacy text changes; old applications keep pointing at the version they actually accepted.
export const PRIVACY_POLICY_VERSION = "v2026-08-01";

// Month precision: a CV does not need the day someone started a job, and asking for less is the
// point. Stored as a date at the start of the month.
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const monthField = (label: string) =>
  z.string().trim().regex(MONTH, `${label} must look like 2024-03.`);

export const employmentEntrySchema = z
  .object({
    employer: z.string().trim().min(1, "Employer is required.").max(120),
    title: z.string().trim().min(1, "Job title is required.").max(120),
    startDate: monthField("Start month"),
    // Empty means "still there" — the ordinary state of a current job, not missing data.
    endDate: z.union([monthField("End month"), z.literal("")]).optional(),
    summary: z.string().trim().max(1000).optional(),
  })
  .refine((e) => !e.endDate || e.endDate >= e.startDate, {
    message: "The end month cannot be before the start month.",
    path: ["endDate"],
  });
export type EmploymentEntry = z.infer<typeof employmentEntrySchema>;

export const educationEntrySchema = z
  .object({
    institution: z.string().trim().min(1, "Institution is required.").max(120),
    qualification: z.string().trim().min(1, "Qualification is required.").max(120),
    startDate: z.union([monthField("Start month"), z.literal("")]).optional(),
    endDate: z.union([monthField("End month"), z.literal("")]).optional(),
  })
  .refine((e) => !e.startDate || !e.endDate || e.endDate >= e.startDate, {
    message: "The end month cannot be before the start month.",
    path: ["endDate"],
  });
export type EducationEntry = z.infer<typeof educationEntrySchema>;

// A cap on how many rows one submission may carry. Not a product rule — a bound on a PUBLIC endpoint,
// so a script cannot post ten thousand employers and turn one application into a storage problem.
export const MAX_HISTORY_ENTRIES = 20;

export const employmentListSchema = z.array(employmentEntrySchema).max(MAX_HISTORY_ENTRIES);
export const educationListSchema = z.array(educationEntrySchema).max(MAX_HISTORY_ENTRIES);

// Consent is a REQUIRED checkbox on the new apply flow. Modelled as a literal `true` rather than a
// boolean so an unchecked box is a validation failure with a message, not a silent `false` that
// records a consent nobody gave.
export const consentSchema = z.literal(true, {
  errorMap: () => ({ message: "Please accept the privacy notice to apply." }),
});

/**
 * The identity and contact fields an applicant may edit about THEMSELVES (M7).
 *
 * Derived from `publicApplicationSchema` rather than restated, so the two forms that collect a
 * person's name cannot drift apart on length limits or trimming.
 *
 * ⚠️ EMAIL IS PICKED OUT DELIBERATELY, and the omission is the security property. It is the login
 * identity — `app_issue_candidate_login` resolves an account by `candidate.email` — and the dedupe
 * key (`@@unique([orgId, email])`). An unverified change would be both an account-takeover surface
 * and a way to collide with someone else's record. `note` is dropped for a duller reason: it belongs
 * to a submission, not to a person.
 *
 * The matching database doorway takes no email parameter at all, so this is enforced twice.
 */
export const profilePersonSchema = publicApplicationSchema.pick({
  firstName: true,
  lastName: true,
  phone: true,
});
export type ProfilePersonInput = z.infer<typeof profilePersonSchema>;

/**
 * Turn a validated month string into the timestamp the database stores.
 * "2024-03" → 2024-03-01T00:00:00.000Z. UTC on purpose: a CV month has no timezone, and letting the
 * server's local zone decide would shift some entries into the previous month.
 */
export function monthToDate(month: string): string {
  return `${month}-01T00:00:00.000Z`;
}

/** The inverse, for prefilling a form from stored dates. */
export function dateToMonth(value: Date | string | null | undefined): string {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 7);
}
