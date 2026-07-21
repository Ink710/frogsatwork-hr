import { describe, it, expect } from "vitest";
import { hoursBetween, formatHours } from "./index.ts";

describe("hoursBetween", () => {
  it("computes decimal hours across two instants", () => {
    expect(hoursBetween("2026-07-20T09:00:00Z", "2026-07-20T17:30:00Z")).toBe(8.5);
    expect(hoursBetween("2026-07-20T09:00:00Z", "2026-07-20T09:15:00Z")).toBe(0.25);
  });

  it("rounds to 2 decimals", () => {
    // 20 minutes = 0.333… → 0.33
    expect(hoursBetween("2026-07-20T09:00:00Z", "2026-07-20T09:20:00Z")).toBe(0.33);
  });

  it("is never negative and treats non-positive / invalid spans as 0", () => {
    expect(hoursBetween("2026-07-20T17:00:00Z", "2026-07-20T09:00:00Z")).toBe(0);
    expect(hoursBetween("not-a-date", "2026-07-20T09:00:00Z")).toBe(0);
  });
});

describe("formatHours", () => {
  it("formats whole, fractional, and sub-hour durations", () => {
    expect(formatHours(8)).toBe("8h");
    expect(formatHours(7.5)).toBe("7h 30m");
    expect(formatHours(0.75)).toBe("45m");
    expect(formatHours(0)).toBe("0m");
  });

  it("rounds minutes and renders a dash for missing/invalid values", () => {
    expect(formatHours(1.999)).toBe("2h"); // 119.94 min → 120 min
    expect(formatHours(null)).toBe("—");
    expect(formatHours(undefined)).toBe("—");
    expect(formatHours(NaN)).toBe("—");
  });
});
