import { describe, it, expect } from "vitest";
import { isScorecardComplete, averageRating } from "./scorecard";

const COMPS = [
  { id: "c1", name: "System design" },
  { id: "c2", name: "Communication" },
];

describe("isScorecardComplete", () => {
  it("requires a recommendation", () => {
    const r = isScorecardComplete(COMPS, [
      { competencyId: "c1", rating: 3 },
      { competencyId: "c2", rating: 4 },
    ]);
    expect(r).toEqual({ ok: false, reason: "MISSING_RECOMMENDATION", missing: [] });
  });

  it("requires every competency to be rated, and names the ones missing", () => {
    const r = isScorecardComplete(COMPS, [{ competencyId: "c1", rating: 3 }], "YES");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("MISSING_RATINGS");
    expect(r.missing).toEqual(["Communication"]);
  });

  it("treats a null/zero rating as unrated", () => {
    const r = isScorecardComplete(
      COMPS,
      [
        { competencyId: "c1", rating: 3 },
        { competencyId: "c2", rating: null },
      ],
      "YES",
    );
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["Communication"]);
  });

  it("passes when everything is rated and a recommendation is given", () => {
    const r = isScorecardComplete(
      COMPS,
      [
        { competencyId: "c1", rating: 3 },
        { competencyId: "c2", rating: 4 },
      ],
      "STRONG_YES",
    );
    expect(r).toEqual({ ok: true });
  });

  it("is vacuously complete for a job with no competencies (still needs a recommendation)", () => {
    expect(isScorecardComplete([], [], "NO")).toEqual({ ok: true });
    expect(isScorecardComplete([], [], null).ok).toBe(false);
  });
});

describe("averageRating", () => {
  it("averages to one decimal", () => {
    expect(averageRating([{ rating: 3 }, { rating: 4 }])).toBe(3.5);
    expect(averageRating([{ rating: 1 }, { rating: 2 }, { rating: 4 }])).toBe(2.3);
  });

  it("returns null (not 0) when nothing is rated — unknown isn't the same as terrible", () => {
    expect(averageRating([])).toBeNull();
  });
});
