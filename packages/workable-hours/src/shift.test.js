import { describe, it, expect } from "vitest";
import { shiftSchema, toShiftInstant, shiftTimeLabel } from "./index.ts";

describe("shiftSchema", () => {
  const base = { date: "2026-07-20", start: "09:00", end: "17:00", role: "Front desk" };

  it("accepts a valid assigned shift and a valid open shift", () => {
    expect(shiftSchema.safeParse({ ...base, employeeId: "emp-1" }).success).toBe(true);
    // No employeeId → open shift.
    const open = shiftSchema.safeParse(base);
    expect(open.success).toBe(true);
    expect(open.data.employeeId).toBeUndefined();
  });

  it("requires end after start", () => {
    const r = shiftSchema.safeParse({ ...base, start: "17:00", end: "09:00" });
    expect(r.success).toBe(false);
    expect(r.error.issues[0].path).toContain("end");
  });

  it("rejects malformed times and dates", () => {
    expect(shiftSchema.safeParse({ ...base, start: "9am" }).success).toBe(false);
    expect(shiftSchema.safeParse({ ...base, end: "25:00" }).success).toBe(false);
    expect(shiftSchema.safeParse({ ...base, date: "07/20/2026" }).success).toBe(false);
  });
});

describe("toShiftInstant / shiftTimeLabel", () => {
  it("builds a UTC instant from date + time and reads it back", () => {
    const inst = toShiftInstant("2026-07-20", "09:30");
    expect(inst.toISOString()).toBe("2026-07-20T09:30:00.000Z");
    expect(shiftTimeLabel(inst)).toBe("09:30");
    expect(shiftTimeLabel("2026-07-20T17:00:00.000Z")).toBe("17:00");
  });
});
