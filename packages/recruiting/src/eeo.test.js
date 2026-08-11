import { describe, it, expect } from "vitest";
import { suppressSmallCells, eeoResponseSchema, EEO_MIN_CELL } from "./eeo";

const counts = (dimension, pairs) =>
  Object.entries(pairs).map(([value, responses]) => ({ dimension, value, responses }));

const cell = (summary, value) => summary.cells.find((c) => c.value === value);

describe("suppressSmallCells", () => {
  it("shows every cell when they all clear the threshold", () => {
    const [g] = suppressSmallCells(counts("gender", { MALE: 12, FEMALE: 9, DECLINED: 5 }));
    expect(g.hasSuppression).toBe(false);
    expect(g.cells.map((c) => c.responses)).toEqual([12, 9, 5]);
    expect(g.total).toBe(26);
  });

  it("withholds a cell below the threshold", () => {
    const [g] = suppressSmallCells(counts("gender", { MALE: 20, FEMALE: 15, NON_BINARY: 2, DECLINED: 8 }));
    expect(cell(g, "NON_BINARY")).toEqual({ value: "NON_BINARY", responses: null, suppressed: true });
    expect(g.hasSuppression).toBe(true);
  });

  it("withholds a SECOND cell when only one would be hidden, so the gap can't be subtracted out", () => {
    // Without complementary suppression: total 45, shown 20 + 15 + 8 = 43 → the hidden cell is
    // obviously 2. The point of the rule is that this arithmetic must not work.
    const [g] = suppressSmallCells(counts("gender", { MALE: 20, FEMALE: 15, NON_BINARY: 2, DECLINED: 8 }));
    const suppressed = g.cells.filter((c) => c.suppressed).map((c) => c.value);
    expect(suppressed).toHaveLength(2);
    expect(suppressed).toContain("NON_BINARY");
    expect(suppressed).toContain("DECLINED"); // the next-smallest non-zero cell
  });

  it("does not need a complement when two cells are already hidden", () => {
    const [g] = suppressSmallCells(counts("gender", { MALE: 30, FEMALE: 2, NON_BINARY: 1, DECLINED: 9 }));
    expect(g.cells.filter((c) => c.suppressed)).toHaveLength(2);
    expect(cell(g, "DECLINED").responses).toBe(9);
  });

  it("never withholds a zero — 'nobody selected this' identifies no one", () => {
    const [g] = suppressSmallCells(counts("gender", { MALE: 30, FEMALE: 20, NON_BINARY: 0, DECLINED: 0 }));
    expect(g.hasSuppression).toBe(false);
    expect(cell(g, "NON_BINARY").responses).toBe(0);
  });

  it("keeps the dimension total honest — it always sums the RAW counts, suppressed or not", () => {
    const [g] = suppressSmallCells(counts("gender", { MALE: 20, FEMALE: 15, NON_BINARY: 2, DECLINED: 8 }));
    expect(g.total).toBe(45);
  });

  it("groups independently per dimension and passes unknown dimensions through", () => {
    const summaries = suppressSmallCells([
      ...counts("gender", { MALE: 20, FEMALE: 20 }),
      ...counts("somethingNew", { A: 1, B: 30 }),
    ]);
    expect(summaries).toHaveLength(2);
    expect(summaries.find((s) => s.dimension === "gender").hasSuppression).toBe(false);
    expect(summaries.find((s) => s.dimension === "somethingNew").hasSuppression).toBe(true);
  });

  it("honours a custom threshold", () => {
    const [g] = suppressSmallCells(counts("gender", { MALE: 3, FEMALE: 3 }), { min: 1 });
    expect(g.hasSuppression).toBe(false);
    expect(EEO_MIN_CELL).toBe(5); // the default the app ships with
  });

  it("returns nothing for no data rather than inventing empty cells", () => {
    expect(suppressSmallCells([])).toEqual([]);
  });
});

describe("eeoResponseSchema", () => {
  it("defaults every unanswered question to DECLINED", () => {
    expect(eeoResponseSchema.parse({})).toEqual({
      gender: "DECLINED",
      ethnicity: "DECLINED",
      veteranStatus: "DECLINED",
      disabilityStatus: "DECLINED",
    });
  });

  it("COERCES an unrecognised value to DECLINED instead of failing", () => {
    // A voluntary question must never be able to reject someone's application.
    const parsed = eeoResponseSchema.parse({ gender: "nonsense", ethnicity: "WHITE" });
    expect(parsed.gender).toBe("DECLINED");
    expect(parsed.ethnicity).toBe("WHITE");
  });

  it("keeps valid answers intact", () => {
    const parsed = eeoResponseSchema.parse({
      gender: "FEMALE",
      ethnicity: "ASIAN",
      veteranStatus: "PROTECTED_VETERAN",
      disabilityStatus: "NO",
    });
    expect(parsed).toEqual({
      gender: "FEMALE",
      ethnicity: "ASIAN",
      veteranStatus: "PROTECTED_VETERAN",
      disabilityStatus: "NO",
    });
  });
});
