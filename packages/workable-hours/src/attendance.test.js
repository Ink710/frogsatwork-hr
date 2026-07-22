import { describe, it, expect } from "vitest";
import { pairPunches, computeAttendanceDay, clockCorrectionSchema, LATE_GRACE_MINUTES } from "./index.ts";

const at = (t) => `2026-07-20T${t}:00.000Z`;
// The seeded Engineering shift for Diego/Priya: 09:00–17:00 (8h). Tom's is 10:00–14:00 (4h).
const shift = { startAt: at("09:00"), endAt: at("17:00") };

describe("pairPunches", () => {
  it("pairs a simple IN → OUT into one session and sums worked hours", () => {
    const r = pairPunches([{ type: "IN", at: at("09:00") }, { type: "OUT", at: at("17:30") }]);
    expect(r.sessions).toHaveLength(1);
    expect(r.workedHours).toBe(8.5);
    expect(r.open).toBe(false);
    expect(r.firstIn.toISOString()).toBe(at("09:00"));
    expect(r.lastOut.toISOString()).toBe(at("17:30"));
  });

  it("sorts out-of-order punches and sums multiple sessions (e.g. a lunch break)", () => {
    const r = pairPunches([
      { type: "OUT", at: at("17:00") },
      { type: "IN", at: at("09:00") },
      { type: "OUT", at: at("12:00") },
      { type: "IN", at: at("13:00") },
    ]);
    expect(r.sessions).toHaveLength(2);
    expect(r.workedHours).toBe(7); // 3h morning + 4h afternoon
    expect(r.open).toBe(false);
  });

  it("treats a trailing IN with no OUT as an OPEN session worth 0 hours", () => {
    const r = pairPunches([{ type: "IN", at: at("09:00") }]);
    expect(r.open).toBe(true);
    expect(r.workedHours).toBe(0);
    expect(r.lastOut).toBeNull();
  });

  it("ignores a duplicate IN (keeps earliest) and a stray OUT with no open IN", () => {
    const r = pairPunches([
      { type: "OUT", at: at("08:00") }, // stray — ignored
      { type: "IN", at: at("09:00") },
      { type: "IN", at: at("09:05") }, // duplicate — ignored
      { type: "OUT", at: at("17:00") },
    ]);
    expect(r.sessions).toHaveLength(1);
    expect(r.firstIn.toISOString()).toBe(at("09:00"));
    expect(r.workedHours).toBe(8);
  });
});

describe("computeAttendanceDay — variance vs the scheduled shift", () => {
  it("ON_TIME when arrival + hours match the schedule", () => {
    const r = computeAttendanceDay([{ type: "IN", at: at("09:00") }, { type: "OUT", at: at("17:00") }], shift);
    expect(r.status).toBe("ON_TIME");
    expect(r.lateMinutes).toBe(0);
    expect(r.shortHours).toBe(0);
  });

  it("LATE when the first punch is past the grace, even if also short", () => {
    // Diego's seeded day: in 09:20 (20m late) / out 17:05 → both late and slightly short → LATE wins.
    const r = computeAttendanceDay([{ type: "IN", at: at("09:20") }, { type: "OUT", at: at("17:05") }], shift);
    expect(r.status).toBe("LATE");
    expect(r.lateMinutes).toBe(20);
  });

  it("stays ON_TIME at the grace boundary (arrival within grace, full hours worked)", () => {
    // In at exactly the grace, out shifted by the same amount so worked hours still equal the 8h shift.
    const r = computeAttendanceDay(
      [{ type: "IN", at: at(`09:0${LATE_GRACE_MINUTES}`) }, { type: "OUT", at: at(`17:0${LATE_GRACE_MINUTES}`) }],
      shift,
    );
    expect(r.lateMinutes).toBe(LATE_GRACE_MINUTES);
    expect(r.shortHours).toBe(0);
    expect(r.status).toBe("ON_TIME");
  });

  it("SHORT when on time but worked fewer than the scheduled hours", () => {
    // Tom's seeded day: 4h shift, worked 3h.
    const tomShift = { startAt: at("10:00"), endAt: at("14:00") };
    const r = computeAttendanceDay([{ type: "IN", at: at("10:00") }, { type: "OUT", at: at("13:00") }], tomShift);
    expect(r.status).toBe("SHORT");
    expect(r.shortHours).toBe(1);
  });

  it("ABSENT when a shift was scheduled but there are no punches", () => {
    expect(computeAttendanceDay([], shift).status).toBe("ABSENT");
  });

  it("OPEN when still clocked in, regardless of schedule", () => {
    expect(computeAttendanceDay([{ type: "IN", at: at("09:00") }], shift).status).toBe("OPEN");
  });

  it("NO_SCHEDULE when punched but nothing was scheduled; NONE when neither", () => {
    expect(computeAttendanceDay([{ type: "IN", at: at("09:00") }, { type: "OUT", at: at("17:00") }], null).status).toBe(
      "NO_SCHEDULE",
    );
    expect(computeAttendanceDay([], null).status).toBe("NONE");
  });
});

describe("clockCorrectionSchema", () => {
  const base = { employeeId: "emp-1", type: "OUT", date: "2026-07-23", time: "17:00" };
  it("accepts a valid correction and rejects a bad type/time", () => {
    expect(clockCorrectionSchema.safeParse(base).success).toBe(true);
    expect(clockCorrectionSchema.safeParse({ ...base, type: "LUNCH" }).success).toBe(false);
    expect(clockCorrectionSchema.safeParse({ ...base, time: "25:00" }).success).toBe(false);
  });
});
