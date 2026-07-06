import { describe, it, expect } from "vitest";
import { humanize, formatDate, formatMoney } from "./format.js";

describe("humanize", () => {
  it("turns enum tokens into readable labels", () => {
    expect(humanize("FULL_TIME")).toBe("Full time");
    expect(humanize("ON_LEAVE")).toBe("On leave");
  });
  it("handles empty input", () => {
    expect(humanize(null)).toBe("—");
    expect(humanize("")).toBe("—");
  });
});

describe("formatMoney", () => {
  it("formats a string/number amount as currency", () => {
    expect(formatMoney("120000")).toBe("$120,000");
    expect(formatMoney("2500000", "USD")).toBe("$2,500,000");
  });
  it("returns null for missing amount (never a blank/zero for guarded comp)", () => {
    expect(formatMoney(null)).toBeNull();
    expect(formatMoney(undefined)).toBeNull();
  });
});

describe("formatDate", () => {
  it("formats a date, returns null for empty", () => {
    expect(formatDate("2023-04-01T00:00:00")).toMatch(/Apr 1, 2023/);
    expect(formatDate(null)).toBeNull();
  });
});
