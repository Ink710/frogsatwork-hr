import { describe, it, expect } from "vitest";
import { leaveRequestSchema, LEAVE_TYPES } from "./index.ts";

describe("leaveRequestSchema", () => {
  const base = { type: "VACATION", startDate: "2026-08-10", endDate: "2026-08-12", hours: "24" };

  it("parses valid input and coerces dates + hours", () => {
    const r = leaveRequestSchema.safeParse(base);
    expect(r.success).toBe(true);
    expect(r.data.hours).toBe(24);
    expect(r.data.startDate).toBeInstanceOf(Date);
    // Stored as UTC midnight so the calendar day can't drift.
    expect(r.data.startDate.toISOString()).toBe("2026-08-10T00:00:00.000Z");
  });

  it("rejects an end date before the start date", () => {
    const r = leaveRequestSchema.safeParse({ ...base, endDate: "2026-08-09" });
    expect(r.success).toBe(false);
    expect(r.error.issues[0].path).toContain("endDate");
  });

  it("rejects non-positive hours", () => {
    expect(leaveRequestSchema.safeParse({ ...base, hours: "0" }).success).toBe(false);
    expect(leaveRequestSchema.safeParse({ ...base, hours: "-8" }).success).toBe(false);
  });

  it("rejects an unknown leave type and a malformed date", () => {
    expect(leaveRequestSchema.safeParse({ ...base, type: "SABBATICAL" }).success).toBe(false);
    expect(leaveRequestSchema.safeParse({ ...base, startDate: "08/10/2026" }).success).toBe(false);
  });

  it("treats employeeId (HR-on-behalf) as optional", () => {
    expect(leaveRequestSchema.safeParse(base).data.employeeId).toBeUndefined();
    expect(leaveRequestSchema.safeParse({ ...base, employeeId: "abc" }).data.employeeId).toBe("abc");
  });

  it("exposes the four leave types", () => {
    expect(LEAVE_TYPES).toEqual(["VACATION", "SICK", "PERSONAL", "UNPAID"]);
  });
});
