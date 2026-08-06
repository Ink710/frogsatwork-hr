// Recruiting (ATS) domain vocabulary + input validation for jobs and hiring teams. Enum tuples
// mirror the Prisma enums in @hris/database as local `as const` tuples so this package stays
// dependency-light (only zod) — the same pattern as @hris/workable-hours and @hris/types.
import { z } from "zod";

export const JOB_STATUSES = ["DRAFT", "OPEN", "PAUSED", "CLOSED", "FILLED"] as const;
export const JOB_MEMBER_ROLES = ["RECRUITER", "HIRING_MANAGER", "INTERVIEWER"] as const;
// Mirrors @hris/database EmploymentType — a job posts for one employment type.
export const JOB_EMPLOYMENT_TYPES = ["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN"] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];
export type JobMemberRole = (typeof JOB_MEMBER_ROLES)[number];

// Create / edit a job requisition.
export const jobSchema = z.object({
  title: z.string().trim().min(1, "Title is required."),
  description: z.string().trim().optional(),
  location: z.string().trim().optional(),
  employmentType: z.enum(JOB_EMPLOYMENT_TYPES),
  status: z.enum(JOB_STATUSES).default("DRAFT"),
  openings: z.coerce.number().int().min(1, "At least one opening."),
  departmentId: z.string().min(1).optional(),
});
export type JobInput = z.infer<typeof jobSchema>;

// One interview round in a job's INTERVIEW phase.
export const interviewRoundSchema = z.object({
  name: z.string().trim().min(1, "Round name is required."),
  position: z.coerce.number().int().min(0),
});
export type InterviewRoundInput = z.infer<typeof interviewRoundSchema>;

// A job's ordered list of interview rounds (the per-job "form"). Positions must be unique.
export const interviewRoundsSchema = z
  .array(interviewRoundSchema)
  .max(12, "Keep it to 12 rounds or fewer.")
  .refine(
    (rounds) => new Set(rounds.map((r) => r.position)).size === rounds.length,
    "Round positions must be unique.",
  );

// Add someone to a job's hiring team.
export const jobMemberSchema = z.object({
  employeeId: z.string().min(1),
  role: z.enum(JOB_MEMBER_ROLES),
});
export type JobMemberInput = z.infer<typeof jobMemberSchema>;
