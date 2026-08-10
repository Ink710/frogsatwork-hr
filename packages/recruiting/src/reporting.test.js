import { describe, it, expect } from "vitest";
import { buildFunnel, daysBetween, averageDays, summariseSources } from "./reporting";

describe("buildFunnel", () => {
  it("computes conversion and drop-off between consecutive stages", () => {
    const f = buildFunnel({ APPLIED: 100, SCREEN: 40, INTERVIEW: 20, OFFER: 5, HIRED: 3 });
    expect(f[0]).toEqual({ stage: "APPLIED", reached: 100, conversionFromPrevious: null, dropOff: null });
    expect(f[1]).toEqual({ stage: "SCREEN", reached: 40, conversionFromPrevious: 40, dropOff: 60 });
    expect(f[3]).toEqual({ stage: "OFFER", reached: 5, conversionFromPrevious: 25, dropOff: 15 });
    expect(f[4].conversionFromPrevious).toBe(60); // 3 of 5 offers accepted
  });

  it("reports a real 0% when people applied but none advanced — that IS the finding", () => {
    const f = buildFunnel({ APPLIED: 3 });
    expect(f[1]).toEqual({ stage: "SCREEN", reached: 0, conversionFromPrevious: 0, dropOff: 3 });
  });

  it("reports null (not 0%) once the PREVIOUS stage itself is empty — no data isn't failure", () => {
    // Nobody reached SCREEN, so "what % of Screens became Interviews?" has no answer. Printing 0%
    // there would read as a failed pipeline when the truth is simply that nobody got that far.
    const f = buildFunnel({ APPLIED: 3 });
    expect(f[2]).toEqual({ stage: "INTERVIEW", reached: 0, conversionFromPrevious: null, dropOff: null });
  });

  it("never reports more than 100% even if the data goes sideways", () => {
    // e.g. someone was moved straight to OFFER by a correction, so OFFER > INTERVIEW.
    const f = buildFunnel({ APPLIED: 10, SCREEN: 5, INTERVIEW: 2, OFFER: 4 });
    expect(f[3].conversionFromPrevious).toBe(100);
    expect(f[3].dropOff).toBe(0); // and never negative
  });

  it("always returns every stage, even for an empty pipeline", () => {
    const f = buildFunnel({});
    expect(f.map((r) => r.stage)).toEqual(["APPLIED", "SCREEN", "INTERVIEW", "OFFER", "HIRED"]);
    expect(f.every((r) => r.reached === 0)).toBe(true);
  });
});

describe("daysBetween", () => {
  it("counts whole days", () => {
    expect(daysBetween("2026-07-10T10:00:00Z", "2026-08-10T10:00:00Z")).toBe(31);
    expect(daysBetween("2026-07-10T10:00:00Z", "2026-07-10T18:00:00Z")).toBe(0);
  });

  it("floors at 0 rather than going negative on out-of-order data", () => {
    expect(daysBetween("2026-08-10T10:00:00Z", "2026-07-10T10:00:00Z")).toBe(0);
  });
});

describe("averageDays", () => {
  it("averages to one decimal and reports the sample size", () => {
    expect(averageDays([10, 20, 31])).toEqual({ days: 20.3, sample: 3 });
  });

  it("returns null (not 0) with no data, so the UI can say 'no hires yet'", () => {
    expect(averageDays([])).toEqual({ days: null, sample: 0 });
  });
});

describe("summariseSources", () => {
  it("computes hire rate and ranks by hires, then volume", () => {
    const rows = summariseSources([
      { source: "LinkedIn", applications: 50, hires: 1 },
      { source: "Referral", applications: 10, hires: 3 },
      { source: "Careers page", applications: 20, hires: 1 },
    ]);
    // Referral leads on hires; LinkedIn and Careers page tie on hires (1 each), so the larger
    // volume breaks the tie.
    expect(rows.map((r) => r.source)).toEqual(["Referral", "LinkedIn", "Careers page"]);
    expect(rows[0]).toEqual({ source: "Referral", applications: 10, hires: 3, hireRate: 30 });
    expect(rows[2].hireRate).toBe(5); // Careers page: 1 of 20
  });

  it("labels a missing source rather than dropping it, and never divides by zero", () => {
    const rows = summariseSources([{ source: null, applications: 0, hires: 0 }]);
    expect(rows[0].source).toBe("Unknown");
    expect(rows[0].hireRate).toBeNull();
  });
});
