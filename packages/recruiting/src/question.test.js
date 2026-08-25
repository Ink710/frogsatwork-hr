import { describe, it, expect } from "vitest";
import { questionSchema, validateAnswers, parseOptions, QUESTION_TYPES, MAX_OPTIONS } from "./question";

const q = (o = {}) => ({ prompt: "Notice period?", type: "SHORT_TEXT", required: false, options: [], ...o });

describe("defining a question", () => {
  it("accepts every supported type", () => {
    for (const type of QUESTION_TYPES) {
      const options = type === "SINGLE_SELECT" ? ["A", "B"] : [];
      expect(questionSchema.safeParse(q({ type, options })).success, type).toBe(true);
    }
  });

  it("requires a prompt", () => {
    expect(questionSchema.safeParse(q({ prompt: "   " })).success).toBe(false);
  });

  it("refuses a multiple-choice question with fewer than two options", () => {
    // One option is a formality, none is unanswerable — neither is a question.
    expect(questionSchema.safeParse(q({ type: "SINGLE_SELECT", options: [] })).success).toBe(false);
    expect(questionSchema.safeParse(q({ type: "SINGLE_SELECT", options: ["Only"] })).success).toBe(false);
    expect(questionSchema.safeParse(q({ type: "SINGLE_SELECT", options: ["A", "B"] })).success).toBe(true);
  });

  it("refuses options on a type that cannot use them", () => {
    // Otherwise a recruiter sets options, sees them ignored on the form, and cannot tell why.
    expect(questionSchema.safeParse(q({ type: "YES_NO", options: ["A", "B"] })).success).toBe(false);
  });

  it("bounds the option count", () => {
    const many = Array.from({ length: MAX_OPTIONS + 1 }, (_, i) => `Option ${i}`);
    expect(questionSchema.safeParse(q({ type: "SINGLE_SELECT", options: many })).success).toBe(false);
  });
});

describe("parseOptions", () => {
  it("splits lines and drops blanks", () => {
    expect(parseOptions("A\n\n  B  \n\nC\n")).toEqual(["A", "B", "C"]);
    expect(parseOptions("")).toEqual([]);
  });
});

describe("validating answers against the questions asked", () => {
  const questions = [
    { id: "q1", prompt: "Authorised to work?", type: "YES_NO", required: true },
    { id: "q2", prompt: "Notice period?", type: "SHORT_TEXT", required: false },
    { id: "q3", prompt: "Preferred location?", type: "SINGLE_SELECT", required: false, options: ["Remote", "Onsite"] },
  ];

  it("accepts a complete set and strips blanks", () => {
    const r = validateAnswers(questions, { q1: "Yes", q2: "  ", q3: "Remote" });
    expect(r.ok).toBe(true);
    // The unanswered optional question stores nothing rather than an empty row.
    expect(r.answers).toEqual([
      { questionId: "q1", value: "Yes" },
      { questionId: "q3", value: "Remote" },
    ]);
  });

  it("names the question when a REQUIRED one is missing", () => {
    const r = validateAnswers(questions, { q2: "One month" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Authorised to work?");
  });

  it("refuses a select value outside the offered options", () => {
    // A tampered form, or a question edited mid-application.
    const r = validateAnswers(questions, { q1: "Yes", q3: "Mars" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Preferred location?");
  });

  it("refuses a yes/no answer that is neither", () => {
    expect(validateAnswers(questions, { q1: "Maybe" }).ok).toBe(false);
  });

  it("refuses an over-long answer", () => {
    expect(validateAnswers(questions, { q1: "Yes", q2: "x".repeat(2001) }).ok).toBe(false);
  });

  it("ignores answers for questions that were not asked", () => {
    // The database discards these too; here it just means they never reach it.
    const r = validateAnswers(questions, { q1: "Yes", "someone-elses-question": "smuggled" });
    expect(r.ok).toBe(true);
    expect(r.answers.map((a) => a.questionId)).toEqual(["q1"]);
  });

  it("accepts a job with no questions at all", () => {
    expect(validateAnswers([], {})).toEqual({ ok: true, answers: [] });
  });
});
