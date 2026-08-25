// Per-job screening questions (M6b) — the vocabulary, and validation for both ends of them:
// a recruiter DEFINING one, and an applicant ANSWERING one.
import { z } from "zod";

// Deliberately small. These are screening questions, not a form builder: each type is one renderer
// on a public form and one validation path, and anything that can hold free text is also another
// erasure consideration.
export const QUESTION_TYPES = ["SHORT_TEXT", "LONG_TEXT", "YES_NO", "SINGLE_SELECT"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const YES_NO_VALUES = ["Yes", "No"] as const;

export const MAX_OPTIONS = 12;

// Defining a question (the ATS side).
export const questionSchema = z
  .object({
    prompt: z.string().trim().min(1, "Ask something.").max(300),
    type: z.enum(QUESTION_TYPES),
    required: z.boolean().default(false),
    // Sent as a newline-separated textarea; empty lines are dropped rather than becoming blank
    // options nobody can choose meaningfully.
    options: z.array(z.string().trim().min(1)).max(MAX_OPTIONS).default([]),
  })
  .superRefine((q, ctx) => {
    if (q.type === "SINGLE_SELECT" && q.options.length < 2) {
      // A select with one option is not a question, it is a formality; with none it is unanswerable.
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["options"],
        message: "Give a multiple-choice question at least two options.",
      });
    }
    if (q.type !== "SINGLE_SELECT" && q.options.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["options"],
        message: "Only multiple-choice questions take options.",
      });
    }
  });
export type QuestionInput = z.infer<typeof questionSchema>;

/** Split a textarea into options. Exported so the form and the tests agree on the parsing. */
export function parseOptions(raw: string): string[] {
  return String(raw ?? "")
    .split("\n")
    .map((o) => o.trim())
    .filter(Boolean);
}

export const MAX_ANSWER_LENGTH = 2000;

/**
 * Validate an applicant's answers against the questions actually asked.
 *
 * ⚠️ THIS IS DEFENCE IN DEPTH, NOT THE GATE. app_submit_application independently refuses a missing
 * required answer and discards answers aimed at another job's questions — it has to, because the
 * apply endpoint is public and can be posted to directly. What this buys is a readable error next to
 * the right field instead of a bare `MISSING_ANSWERS` from the database.
 *
 * Returns `{ ok: true, answers }` with blanks stripped, or `{ ok: false, error }`.
 */
export function validateAnswers(
  questions: readonly { id: string; prompt: string; type: string; required: boolean; options?: string[] }[],
  raw: Record<string, string>,
): { ok: true; answers: { questionId: string; value: string }[] } | { ok: false; error: string } {
  const answers: { questionId: string; value: string }[] = [];

  for (const q of questions) {
    const value = String(raw?.[q.id] ?? "").trim();

    if (!value) {
      if (q.required) return { ok: false, error: `Please answer: ${q.prompt}` };
      continue; // an unanswered optional question stores nothing rather than an empty row
    }

    if (value.length > MAX_ANSWER_LENGTH) {
      return { ok: false, error: `That answer is too long: ${q.prompt}` };
    }
    if (q.type === "YES_NO" && !YES_NO_VALUES.includes(value as (typeof YES_NO_VALUES)[number])) {
      return { ok: false, error: `Please answer yes or no: ${q.prompt}` };
    }
    if (q.type === "SINGLE_SELECT" && !(q.options ?? []).includes(value)) {
      // A value outside the offered set means a tampered form — or a question edited mid-application.
      return { ok: false, error: `Please choose one of the options: ${q.prompt}` };
    }

    answers.push({ questionId: q.id, value });
  }

  return { ok: true, answers };
}
