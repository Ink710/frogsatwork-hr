// Project vocabulary + input validation (M8). Assignment-based: a manager/HR creates a project and
// assigns employees; the assignment table (RLS'd) controls who may log time to it. Pure — no I/O.
import { z } from "zod";

export const PROJECT_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

// Create / rename a project. `code` is an optional short tag (e.g. "PLAT"), shown monospaced.
export const projectSchema = z.object({
  name: z.string().trim().min(1, "A project needs a name.").max(120),
  code: z.string().trim().max(16).optional(),
});

export type ProjectInput = z.infer<typeof projectSchema>;
