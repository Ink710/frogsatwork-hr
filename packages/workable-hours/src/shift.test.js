import { describe, it, expect } from "vitest";
import { shiftSchema, batchShiftSchema, toShiftInstant, zonedWallClockToUtc, shiftTimeLabel, dayKeyInZone } from "./index.ts";

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

describe("batchShiftSchema", () => {
  const base = { employeeIds: ["e1", "e2"], days: ["2026-07-20", "2026-07-21"], start: "09:00", end: "17:00" };

  it("accepts multiple employees × days", () => {
    expect(batchShiftSchema.safeParse(base).success).toBe(true);
  });

  it("accepts open-only (no employees) and defaults employeeIds/open", () => {
    const r = batchShiftSchema.safeParse({ open: true, days: ["2026-07-20"], start: "09:00", end: "17:00" });
    expect(r.success).toBe(true);
    expect(r.data.employeeIds).toEqual([]);
  });

  it("rejects when neither an employee nor open is chosen", () => {
    expect(batchShiftSchema.safeParse({ employeeIds: [], open: false, days: ["2026-07-20"], start: "09:00", end: "17:00" }).success).toBe(false);
  });

  it("rejects no days and end ≤ start", () => {
    expect(batchShiftSchema.safeParse({ ...base, days: [] }).success).toBe(false);
    expect(batchShiftSchema.safeParse({ ...base, start: "17:00", end: "09:00" }).success).toBe(false);
  });
});

describe("zonedWallClockToUtc + shiftTimeLabel (timezone-aware)", () => {
  it("UTC default keeps the old fake-UTC behavior", () => {
    expect(zonedWallClockToUtc("2026-07-20", "09:00").toISOString()).toBe("2026-07-20T09:00:00.000Z");
    expect(shiftTimeLabel("2026-07-20T09:00:00.000Z")).toBe("09:00");
  });

  it("interprets wall-clock in a real zone (America/Mexico_City is UTC−6)", () => {
    // 09:00 local in a UTC−6 zone is 15:00 UTC.
    expect(zonedWallClockToUtc("2026-07-20", "09:00", "America/Mexico_City").toISOString()).toBe(
      "2026-07-20T15:00:00.000Z",
    );
  });

  it("labels a true UTC instant back in the viewer's zone", () => {
    expect(shiftTimeLabel("2026-07-20T15:00:00.000Z", "America/Mexico_City")).toBe("09:00");
    expect(shiftTimeLabel("2026-07-20T15:00:00.000Z", "UTC")).toBe("15:00");
  });

  it("dayKeyInZone: an instant's local calendar date follows the zone (evening rollover)", () => {
    // 2026-08-04 01:00 UTC is still Aug 3 in Mexico City (UTC−6) but already Aug 4 in Tokyo (UTC+9).
    const inst = "2026-08-04T01:00:00.000Z";
    expect(dayKeyInZone(inst, "UTC")).toBe("2026-08-04");
    expect(dayKeyInZone(inst, "America/Mexico_City")).toBe("2026-08-03");
    expect(dayKeyInZone(inst, "Asia/Tokyo")).toBe("2026-08-04");
  });

  it("round-trips: build in a zone, label in the same zone, returns the input", () => {
    for (const [time, tz] of [
      ["08:30", "America/Mexico_City"],
      ["14:45", "America/New_York"],
      ["23:15", "Europe/Madrid"],
      ["00:05", "Asia/Tokyo"],
    ]) {
      const instant = zonedWallClockToUtc("2026-07-20", time, tz);
      expect(shiftTimeLabel(instant, tz)).toBe(time);
    }
  });
});
