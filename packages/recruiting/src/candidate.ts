// Candidate + application vocabulary and input validation. The stage enum mirrors the Prisma
// ApplicationStage; the pure transition rules live in ./rules.
import { z } from "zod";

export const APPLICATION_STAGES = [
  "APPLIED",
  "SCREEN",
  "INTERVIEW",
  "OFFER",
  "HIRED",
  "REJECTED",
  "WITHDRAWN",
] as const;
export type ApplicationStage = (typeof APPLICATION_STAGES)[number];

// Create / update a candidate (a person). Email is the dedupe key within an org, so it's normalized.
export const candidateSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required."),
  lastName: z.string().trim().min(1, "Last name is required."),
  email: z.string().trim().toLowerCase().email("Enter a valid email."),
  phone: z.string().trim().optional(),
  source: z.string().trim().optional(),
});
export type CandidateInput = z.infer<typeof candidateSchema>;

// Create an application (a candidate applies to a job).
export const applicationSchema = z.object({
  jobId: z.string().min(1),
  candidateId: z.string().min(1),
});
export type ApplicationInput = z.infer<typeof applicationSchema>;

// A PUBLIC application submitted from the careers site by someone with no account. Deliberately
// minimal: only what a stranger should be able to put into the system. Everything else about the
// application (stage, job, org) is decided server-side — see app_submit_application.
export const publicApplicationSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required.").max(100),
  lastName: z.string().trim().min(1, "Last name is required.").max(100),
  email: z.string().trim().toLowerCase().email("Enter a valid email."),
  phone: z.string().trim().max(40).optional(),
  note: z.string().trim().max(2000).optional(),
});
export type PublicApplicationInput = z.infer<typeof publicApplicationSchema>;

// Résumé upload limits, enforced server-side before a byte is stored.
export const RESUME_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
export const RESUME_EXTENSIONS = ["pdf", "doc", "docx"] as const;
export const RESUME_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

/**
 * Check an uploaded résumé BEFORE a byte is stored (M7).
 *
 * Returns a CODE, not a message: three call sites now check the same file — the public apply form,
 * the ATS careers fallback, and the applicant's own profile editor — and each phrases the failure in
 * its own dictionary. Returning `t("apply.fileTooLarge")` from a package that must stay
 * dependency-light (zod only) would drag i18n in behind it.
 *
 * ⚠️ Both the MIME type and the extension must pass. Either alone is trivially spoofed: a browser
 * will happily report `application/pdf` for a renamed executable, and an attacker controls the
 * filename outright. Requiring both is not belt-and-braces — it is the cheapest available check that
 * two independently-supplied claims agree.
 */
export function resumeFileError(
  file: { size?: number; name?: string; type?: string } | null | undefined,
): "TOO_LARGE" | "BAD_TYPE" | null {
  if (!file || !file.size) return null; // no file attached is not an error — a CV is optional
  if (file.size > RESUME_MAX_BYTES) return "TOO_LARGE";
  const ext = (file.name?.split(".").pop() ?? "").toLowerCase();
  if (!RESUME_MIME_TYPES.includes(file.type as never)) return "BAD_TYPE";
  if (!RESUME_EXTENSIONS.includes(ext as never)) return "BAD_TYPE";
  return null;
}

// A PUBLIC request to erase a candidate's personal data (GDPR, M10). Submitted by someone with no
// account, so it carries nothing that could aim it: no candidate id, no org — just an address, which
// app_request_erasure resolves server-side. `reason` is optional because the right to erasure does
// not require one; we ask only because it helps HR answer well.
export const erasureRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email."),
  reason: z.string().trim().max(1000).optional(),
});
export type ErasureRequestInput = z.infer<typeof erasureRequestSchema>;

// HR's decision on a request, or a direct erasure from a candidate's profile. The note is required
// on a REFUSAL — refusing a data-subject request without recording why is exactly the gap an
// auditor looks for.
export const erasureDecisionSchema = z.object({
  note: z.string().trim().max(1000).optional(),
});

/**
 * Marking someone as a great lead (M16) — "strong, wrong role, call them next time".
 *
 * The note is OPTIONAL: the mark alone is a useful signal, and forcing a sentence out of someone in
 * a hurry produces "good" and "nice" rather than nothing, which is worse than nothing because it
 * looks like information. When it IS written it becomes searchable alongside name and email, which
 * is what makes the pool answer "who did we like for backend work?" rather than just listing people.
 */
export const leadSchema = z.object({
  note: z.string().trim().max(500, "Keep the note under 500 characters.").optional(),
});
export type LeadInput = z.infer<typeof leadSchema>;

// The structured reasons a candidate can be rejected for (M12). Fixed and org-wide: per-requisition
// values can't be compared across requisitions, and comparison is the whole point.
export const REJECTION_REASONS = [
  "SKILLS_MISMATCH",
  "EXPERIENCE_LEVEL",
  "COMPENSATION_EXPECTATIONS",
  "STRONGER_CANDIDATE",
  "CANDIDATE_WITHDREW",
  "POSITION_CLOSED",
  "OTHER",
] as const;
export type RejectionReasonValue = (typeof REJECTION_REASONS)[number];

/**
 * Move an application to a new stage (the pipeline action).
 *
 * `rejectionCategory` (structured) is REQUIRED when moving to REJECTED; `rejectionReason` (free
 * text) stays optional and carries the specifics. The pairing is deliberate — an erasure blanks the
 * prose and keeps the category, which is what lets the rejection report survive someone being
 * forgotten.
 *
 * The requirement lives here, in the shared schema, rather than in the server action or the form,
 * so the three cannot drift apart about when a category is needed. A rule enforced in one of three
 * places is a rule that will eventually be enforced in none.
 */
export const stageTransitionSchema = z
  .object({
    toStage: z.enum(APPLICATION_STAGES),
    note: z.string().trim().optional(),
    rejectionReason: z.string().trim().optional(),
    rejectionCategory: z.enum(REJECTION_REASONS).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.toStage === "REJECTED" && !value.rejectionCategory) {
      ctx.addIssue({
        code: "custom",
        path: ["rejectionCategory"],
        message: "Choose a reason for rejecting this candidate.",
      });
    }
  });
export type StageTransitionInput = z.infer<typeof stageTransitionSchema>;
