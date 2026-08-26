import { describe, it, expect } from "vitest";
import {
  slotStatus,
  canConfirm,
  canPublish,
  canCancel,
  isClaimable,
  zonedWallClockToUtc,
  utcToZonedWallClock,
  formatSlotWhen,
  interviewSlotSchema,
  canSelfSchedule,
} from "./slot";

describe("the derived status", () => {
  it("reads the lifecycle in order", () => {
    expect(slotStatus({})).toBe("PROPOSED");
    expect(slotStatus({ confirmedAt: new Date() })).toBe("CONFIRMED");
    expect(slotStatus({ confirmedAt: new Date(), publishedAt: new Date() })).toBe("PUBLISHED");
    expect(slotStatus({ confirmedAt: new Date(), publishedAt: new Date(), claimedAt: new Date() })).toBe("CLAIMED");
  });

  // ⚠️ The one case where the order is NOT the lifecycle order.
  it("reports a cancelled slot as cancelled even when it was claimed", () => {
    expect(
      slotStatus({ confirmedAt: new Date(), publishedAt: new Date(), claimedAt: new Date(), cancelledAt: new Date() }),
    ).toBe("CANCELLED");
    // Showing "claimed" here would tell a recruiter someone is still coming.
  });
});

describe("the workflow predicates", () => {
  const confirmed = { confirmedAt: new Date() };

  it("lets the interviewer confirm only while it is waiting for them", () => {
    expect(canConfirm({})).toBe(true);
    expect(canConfirm(confirmed)).toBe(false);
    expect(canConfirm({ cancelledAt: new Date() })).toBe(false);
  });

  // ⚠️ This predicate IS the two-person rule.
  it("refuses to publish a slot nobody has confirmed", () => {
    expect(canPublish({})).toBe(false);
    expect(canPublish(confirmed)).toBe(true);
    expect(canPublish({ ...confirmed, publishedAt: new Date() })).toBe(false);
    expect(canPublish({ ...confirmed, cancelledAt: new Date() })).toBe(false);
  });

  it("allows cancelling anything not already cancelled, including a claimed slot", () => {
    expect(canCancel({ claimedAt: new Date() })).toBe(true);
    expect(canCancel({ cancelledAt: new Date() })).toBe(false);
  });

  it("matches the doorway on what is claimable", () => {
    expect(isClaimable({ ...confirmed, publishedAt: new Date() })).toBe(true);
    expect(isClaimable(confirmed)).toBe(false); // never published
    expect(isClaimable({ ...confirmed, publishedAt: new Date(), claimedAt: new Date() })).toBe(false);
    expect(isClaimable({ ...confirmed, publishedAt: new Date(), cancelledAt: new Date() })).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// The time arithmetic — the part the whole timezone decision rests on.
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe("wall clock in a named zone → an absolute instant", () => {
  it("converts a fixed-offset zone", () => {
    // Mexico City abolished DST in 2022, so it is UTC-6 all year.
    expect(zonedWallClockToUtc("2026-03-03T15:00", "America/Mexico_City").toISOString()).toBe(
      "2026-03-03T21:00:00.000Z",
    );
  });

  it("converts UTC to itself", () => {
    expect(zonedWallClockToUtc("2026-03-03T15:00", "UTC").toISOString()).toBe("2026-03-03T15:00:00.000Z");
  });

  // ⚠️ THE CASE THE TWO-PASS ALGORITHM EXISTS FOR. A single pass picks the offset in force at the
  // GUESSED instant, which is on the wrong side of the boundary for times near a transition.
  it("handles a zone on either side of a DST change", () => {
    // New York: EST (UTC-5) in winter, EDT (UTC-4) in summer. 2026 spring-forward is 8 March.
    expect(zonedWallClockToUtc("2026-03-07T12:00", "America/New_York").toISOString()).toBe(
      "2026-03-07T17:00:00.000Z", // EST, UTC-5
    );
    expect(zonedWallClockToUtc("2026-03-09T12:00", "America/New_York").toISOString()).toBe(
      "2026-03-09T16:00:00.000Z", // EDT, UTC-4
    );
  });

  it("handles a southern-hemisphere zone, where the seasons invert", () => {
    // Sydney: AEDT (UTC+11) in January, AEST (UTC+10) in July.
    expect(zonedWallClockToUtc("2026-01-15T09:00", "Australia/Sydney").toISOString()).toBe(
      "2026-01-14T22:00:00.000Z",
    );
    expect(zonedWallClockToUtc("2026-07-15T09:00", "Australia/Sydney").toISOString()).toBe(
      "2026-07-14T23:00:00.000Z",
    );
  });

  it("round-trips back to the same wall clock", () => {
    for (const [wall, zone] of [
      ["2026-03-03T15:00", "America/Mexico_City"],
      ["2026-07-15T09:30", "Australia/Sydney"],
      ["2026-11-02T08:00", "America/New_York"],
      ["2026-06-01T23:45", "Europe/Madrid"],
    ]) {
      expect(utcToZonedWallClock(zonedWallClockToUtc(wall, zone), zone)).toBe(wall);
    }
  });

  it("rejects anything that is not a wall clock", () => {
    expect(() => zonedWallClockToUtc("2026-03-03", "UTC")).toThrow();
    expect(() => zonedWallClockToUtc("2026-03-03T15:00:00Z", "UTC")).toThrow();
    expect(() => zonedWallClockToUtc("", "UTC")).toThrow();
  });

  // The bug this replaces: `new Date("2026-03-03T15:00")` is parsed in the SERVER's zone, so the
  // same input yields a different instant depending on where the code runs.
  //
  // ⚠️ An earlier version of this test asserted the helper differed from `new Date(wall)`. That is
  // MACHINE-DEPENDENT and it failed here — this host happens to sit at UTC-6, so the two agreed by
  // coincidence. Proving the zone argument is actually honoured needs no reference to the host at
  // all: one wall clock, several zones, distinct instants, all absolute.
  it("honours the zone argument rather than the machine's", () => {
    const wall = "2026-03-03T15:00";
    expect(zonedWallClockToUtc(wall, "America/Mexico_City").toISOString()).toBe("2026-03-03T21:00:00.000Z");
    expect(zonedWallClockToUtc(wall, "Europe/Madrid").toISOString()).toBe("2026-03-03T14:00:00.000Z");
    expect(zonedWallClockToUtc(wall, "Asia/Tokyo").toISOString()).toBe("2026-03-03T06:00:00.000Z");
    expect(zonedWallClockToUtc(wall, "UTC").toISOString()).toBe("2026-03-03T15:00:00.000Z");
  });
});

describe("the canonical rendering", () => {
  const slot = {
    startAt: "2026-03-03T21:00:00.000Z",
    endAt: "2026-03-03T22:00:00.000Z",
    timeZone: "America/Mexico_City",
  };

  it("shows the local wall clock and always names the zone", () => {
    const s = formatSlotWhen(slot);
    expect(s).toContain("15:00");
    expect(s).toContain("16:00");
    expect(s).toContain("America/Mexico_City");
    expect(s).toContain("2026");
  });

  it("renders the same instant differently in a different zone, and says so", () => {
    const there = formatSlotWhen({ ...slot, timeZone: "Europe/Madrid" });
    expect(there).toContain("Europe/Madrid");
    expect(there).not.toContain("15:00"); // 22:00 in Madrid — the reason the zone is always named
  });

  it("localises the words but not the meaning", () => {
    const es = formatSlotWhen(slot, "es");
    expect(es).toContain("America/Mexico_City");
    expect(es).toContain("15:00");
  });
});

describe("the proposal schema", () => {
  const valid = {
    roundId: "ir-1",
    interviewerEmployeeId: "emp-1",
    startsAt: "2026-03-03T15:00",
    timeZone: "America/Mexico_City",
    durationMinutes: 60,
  };

  it("accepts a complete proposal", () => {
    expect(interviewSlotSchema.parse(valid).durationMinutes).toBe(60);
  });

  it("coerces a duration arriving as a form string", () => {
    expect(interviewSlotSchema.parse({ ...valid, durationMinutes: "45" }).durationMinutes).toBe(45);
  });

  it("rejects a duration nobody offered", () => {
    expect(interviewSlotSchema.safeParse({ ...valid, durationMinutes: 37 }).success).toBe(false);
  });

  it("requires a round, an interviewer, a time and a zone", () => {
    for (const key of ["roundId", "interviewerEmployeeId", "startsAt", "timeZone"]) {
      expect(interviewSlotSchema.safeParse({ ...valid, [key]: "" }).success).toBe(false);
    }
  });

  it("treats an empty meeting link as absent, but rejects a malformed one", () => {
    expect(interviewSlotSchema.safeParse({ ...valid, meetingUrl: "" }).success).toBe(true);
    expect(interviewSlotSchema.safeParse({ ...valid, meetingUrl: "https://meet.example/abc" }).success).toBe(true);
    expect(interviewSlotSchema.safeParse({ ...valid, meetingUrl: "not a url" }).success).toBe(false);
  });
});

// ── M11: the once-only rule ──────────────────────────────────────────────────────────────────

describe("canSelfSchedule", () => {
  it("allows a first choice and refuses a second", () => {
    expect(canSelfSchedule({ booked: false })).toBe(true);
    expect(canSelfSchedule({ booked: true })).toBe(false);
  });

  // ⚠️ The predicate and the doorway must agree, because the UI asks one and the database enforces
  // the other. This asserts the shape of that agreement: a slot being claimable is about the SLOT,
  // while being allowed to choose is about the APPLICATION — two different questions, and conflating
  // them is how a picker ends up offering a time that will be refused.
  it("is about the application, not the slot", () => {
    const freeSlot = { confirmedAt: new Date(), publishedAt: new Date() };
    expect(isClaimable(freeSlot)).toBe(true);
    // …but if this application already booked its round, it may still not choose.
    expect(canSelfSchedule({ booked: true })).toBe(false);
  });
});
