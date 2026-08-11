import { describe, it, expect } from "vitest";
import { summariseRejections } from "./reporting";
import { stageTransitionSchema, REJECTION_REASONS } from "./candidate";

describe("stageTransitionSchema — a rejection must say why", () => {
  it("refuses REJECTED without a category", () => {
    const r = stageTransitionSchema.safeParse({ toStage: "REJECTED" });
    expect(r.success).toBe(false);
    expect(r.error.issues[0].path).toEqual(["rejectionCategory"]);
  });

  it("refuses REJECTED when only the free text is supplied", () => {
    // Prose is exactly what an erasure blanks, so it cannot be the thing that carries the reason.
    const r = stageTransitionSchema.safeParse({
      toStage: "REJECTED",
      rejectionReason: "Went with someone more senior",
    });
    expect(r.success).toBe(false);
  });

  it("accepts REJECTED with a category, and keeps the free text alongside it", () => {
    const r = stageTransitionSchema.safeParse({
      toStage: "REJECTED",
      rejectionCategory: "STRONGER_CANDIDATE",
      rejectionReason: "Went with someone more senior",
    });
    expect(r.success).toBe(true);
    expect(r.data.rejectionCategory).toBe("STRONGER_CANDIDATE");
    expect(r.data.rejectionReason).toBe("Went with someone more senior");
  });

  it("accepts every other stage with no category at all", () => {
    for (const toStage of ["APPLIED", "SCREEN", "INTERVIEW", "OFFER", "HIRED", "WITHDRAWN"]) {
      expect(stageTransitionSchema.safeParse({ toStage }).success).toBe(true);
    }
  });

  it("rejects a category that isn't in the fixed list", () => {
    const r = stageTransitionSchema.safeParse({ toStage: "REJECTED", rejectionCategory: "VIBES" });
    expect(r.success).toBe(false);
  });

  it("accepts each of the defined reasons", () => {
    for (const rejectionCategory of REJECTION_REASONS) {
      expect(stageTransitionSchema.safeParse({ toStage: "REJECTED", rejectionCategory }).success).toBe(true);
    }
  });
});

describe("summariseRejections", () => {
  const rows = [
    { category: "SKILLS_MISMATCH", count: 6 },
    { category: "STRONGER_CANDIDATE", count: 3 },
    { category: "COMPENSATION_EXPECTATIONS", count: 1 },
  ];

  it("ranks by count and computes each share of the categorised total", () => {
    const r = summariseRejections(rows);
    expect(r.rows.map((x) => x.category)).toEqual([
      "SKILLS_MISMATCH",
      "STRONGER_CANDIDATE",
      "COMPENSATION_EXPECTATIONS",
    ]);
    expect(r.rows[0].share).toBe(60);
    expect(r.categorised).toBe(10);
  });

  it("reports pre-M12 rejections separately instead of folding them into OTHER", () => {
    // "We never asked" and "the recruiter chose Other" are different facts.
    const r = summariseRejections([...rows, { category: null, count: 4 }]);
    expect(r.uncategorised).toBe(4);
    expect(r.categorised).toBe(10);
    expect(r.rows.some((x) => x.category === "OTHER")).toBe(false);
  });

  it("keeps shares totalling 100 regardless of the uncategorised backlog", () => {
    const r = summariseRejections([...rows, { category: null, count: 99 }]);
    expect(r.rows.reduce((sum, x) => sum + x.share, 0)).toBeCloseTo(100, 1);
  });

  it("breaks ties by name so the order is stable between renders", () => {
    const r = summariseRejections([
      { category: "STRONGER_CANDIDATE", count: 2 },
      { category: "EXPERIENCE_LEVEL", count: 2 },
    ]);
    expect(r.rows.map((x) => x.category)).toEqual(["EXPERIENCE_LEVEL", "STRONGER_CANDIDATE"]);
  });

  it("survives a history with nothing categorised at all", () => {
    const r = summariseRejections([{ category: null, count: 7 }]);
    expect(r).toEqual({ rows: [], categorised: 0, uncategorised: 7 });
  });

  it("returns empty for no rejections", () => {
    expect(summariseRejections([])).toEqual({ rows: [], categorised: 0, uncategorised: 0 });
  });
});
