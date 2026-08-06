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

// Move an application to a new stage (the pipeline action). `rejectionReason` is used when moving to
// REJECTED; `note` is an optional decision note recorded on the ApplicationEvent.
export const stageTransitionSchema = z.object({
  toStage: z.enum(APPLICATION_STAGES),
  note: z.string().trim().optional(),
  rejectionReason: z.string().trim().optional(),
});
export type StageTransitionInput = z.infer<typeof stageTransitionSchema>;
