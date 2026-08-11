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

// Move an application to a new stage (the pipeline action). `rejectionReason` is used when moving to
// REJECTED; `note` is an optional decision note recorded on the ApplicationEvent.
export const stageTransitionSchema = z.object({
  toStage: z.enum(APPLICATION_STAGES),
  note: z.string().trim().optional(),
  rejectionReason: z.string().trim().optional(),
});
export type StageTransitionInput = z.infer<typeof stageTransitionSchema>;
