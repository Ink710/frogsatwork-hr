import { describe, it, expect } from "vitest";
import { meetingSchema, meetingDurationHours } from "./index.ts";

describe("meetingSchema", () => {
  const valid = { name: "Week Kickstart", dayOfWeek: 1, startTime: "09:00", endTime: "09:30" };

  it("accepts a well-formed meeting", () => {
    const r = meetingSchema.safeParse(valid);
    expect(r.success).toBe(true);
  });

  it("coerces a string dayOfWeek (form values arrive as strings)", () => {
    const r = meetingSchema.safeParse({ ...valid, dayOfWeek: "3" });
    expect(r.success).toBe(true);
    expect(r.data.dayOfWeek).toBe(3);
  });

  it("rejects a weekday out of 0–6", () => {
    expect(meetingSchema.safeParse({ ...valid, dayOfWeek: 7 }).success).toBe(false);
    expect(meetingSchema.safeParse({ ...valid, dayOfWeek: -1 }).success).toBe(false);
  });

  it("rejects a malformed time and end <= start", () => {
    expect(meetingSchema.safeParse({ ...valid, startTime: "9am" }).success).toBe(false);
    expect(meetingSchema.safeParse({ ...valid, startTime: "10:00", endTime: "09:00" }).success).toBe(false);
    expect(meetingSchema.safeParse({ ...valid, startTime: "09:00", endTime: "09:00" }).success).toBe(false);
  });

  it("requires a name", () => {
    expect(meetingSchema.safeParse({ ...valid, name: "   " }).success).toBe(false);
  });
});

describe("meetingDurationHours", () => {
  it("computes the wall-clock duration in decimal hours", () => {
    expect(meetingDurationHours("09:00", "09:30")).toBe(0.5);
    expect(meetingDurationHours("14:00", "15:00")).toBe(1);
    expect(meetingDurationHours("09:00", "17:30")).toBe(8.5);
  });

  it("returns 0 when end is not after start (defensive; schema already blocks it)", () => {
    expect(meetingDurationHours("10:00", "09:00")).toBe(0);
  });
});
