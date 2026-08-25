import { describe, it, expect } from "vitest";
import {
  employmentEntrySchema,
  educationEntrySchema,
  employmentListSchema,
  consentSchema,
  monthToDate,
  dateToMonth,
  MAX_HISTORY_ENTRIES,
} from "./application";

const job = (o = {}) => ({ employer: "Acme", title: "Engineer", startDate: "2022-01", ...o });

describe("employment entries", () => {
  it("accepts a current role with no end month", () => {
    // An empty end month means "still there" — the ordinary state, not missing data.
    expect(employmentEntrySchema.safeParse(job({ endDate: "" })).success).toBe(true);
    expect(employmentEntrySchema.safeParse(job()).success).toBe(true);
  });

  it("rejects an end month BEFORE the start month", () => {
    const r = employmentEntrySchema.safeParse(job({ startDate: "2022-06", endDate: "2022-01" }));
    expect(r.success).toBe(false);
    expect(r.error.issues[0].path).toEqual(["endDate"]);
  });

  it("accepts an end month equal to the start month (a one-month job is real)", () => {
    expect(employmentEntrySchema.safeParse(job({ startDate: "2022-06", endDate: "2022-06" })).success).toBe(true);
  });

  it("rejects malformed months, including a 13th one", () => {
    for (const bad of ["2022", "22-01", "2022-13", "2022-00", "March 2022", ""]) {
      expect(employmentEntrySchema.safeParse(job({ startDate: bad })).success, bad).toBe(false);
    }
  });

  it("requires an employer and a title", () => {
    expect(employmentEntrySchema.safeParse(job({ employer: "  " })).success).toBe(false);
    expect(employmentEntrySchema.safeParse(job({ title: "" })).success).toBe(false);
  });

  it("bounds the free-text summary", () => {
    expect(employmentEntrySchema.safeParse(job({ summary: "x".repeat(1001) })).success).toBe(false);
    expect(employmentEntrySchema.safeParse(job({ summary: "x".repeat(1000) })).success).toBe(true);
  });
});

describe("the list cap", () => {
  it("refuses more entries than the cap", () => {
    // A bound on a PUBLIC endpoint, not a product rule: without it one POST can carry any number of
    // rows into the database.
    const many = Array.from({ length: MAX_HISTORY_ENTRIES + 1 }, () => job());
    expect(employmentListSchema.safeParse(many).success).toBe(false);
    expect(employmentListSchema.safeParse(many.slice(0, MAX_HISTORY_ENTRIES)).success).toBe(true);
  });

  it("accepts an empty history — plenty of people have none to declare", () => {
    expect(employmentListSchema.safeParse([]).success).toBe(true);
  });
});

describe("education entries", () => {
  it("allows both dates to be absent", () => {
    expect(educationEntrySchema.safeParse({ institution: "State U", qualification: "BSc" }).success).toBe(true);
  });

  it("still rejects an end before a start when both are given", () => {
    const r = educationEntrySchema.safeParse({
      institution: "State U", qualification: "BSc", startDate: "2020-01", endDate: "2019-01",
    });
    expect(r.success).toBe(false);
  });
});

describe("consent", () => {
  it("requires an explicit true — an unchecked box is a failure, not a silent false", () => {
    expect(consentSchema.safeParse(true).success).toBe(true);
    expect(consentSchema.safeParse(false).success).toBe(false);
    expect(consentSchema.safeParse(undefined).success).toBe(false);
  });
});

describe("month conversion", () => {
  it("anchors a month to the first day, in UTC", () => {
    // UTC on purpose: a CV month has no timezone, and the server's local zone could shift an entry
    // into the previous month.
    expect(monthToDate("2024-03")).toBe("2024-03-01T00:00:00.000Z");
  });

  it("round-trips a stored date back to a month", () => {
    expect(dateToMonth(new Date("2024-03-01T00:00:00.000Z"))).toBe("2024-03");
    expect(dateToMonth(null)).toBe("");
    expect(dateToMonth(undefined)).toBe("");
  });
});
