import { describe, it, expect } from "vitest";
import {
  isEligibleForArchive,
  resolveRetentionDays,
  ACTIVE_STAGES,
  DEFAULT_RETENTION_DAYS,
} from "./retention";

const NOW = new Date("2026-08-11T12:00:00.000Z");
const daysAgo = (n) => new Date(NOW.getTime() - n * 86_400_000);

// A candidate who is closed out and long idle — the baseline the sweep exists to catch.
const stale = (over = {}) => ({
  lastActivityAt: daysAgo(400),
  stages: ["REJECTED"],
  ...over,
});

const decide = (state, opts) => isEligibleForArchive(state, { now: NOW, ...opts });

describe("isEligibleForArchive", () => {
  it("archives a closed-out candidate who has been idle past the window", () => {
    expect(decide(stale())).toEqual({ eligible: true, reason: null });
  });

  it("NEVER archives someone still live in a pipeline, however long they've been quiet", () => {
    for (const stage of ACTIVE_STAGES) {
      const d = decide(stale({ stages: [stage], lastActivityAt: daysAgo(3000) }));
      expect(d).toEqual({ eligible: false, reason: "ACTIVE_PIPELINE" });
    }
  });

  it("treats ANY active application as protective, even alongside closed ones", () => {
    const d = decide(stale({ stages: ["REJECTED", "WITHDRAWN", "SCREEN"] }));
    expect(d.reason).toBe("ACTIVE_PIPELINE");
  });

  it("DOES archive a hired candidate — their record lives in employee-records now", () => {
    expect(decide(stale({ stages: ["HIRED"] })).eligible).toBe(true);
  });

  it("leaves a recently active candidate alone", () => {
    expect(decide(stale({ lastActivityAt: daysAgo(10) }))).toEqual({
      eligible: false,
      reason: "TOO_RECENT",
    });
  });

  it("uses >= at the boundary, so the window means what it says", () => {
    expect(decide(stale({ lastActivityAt: daysAgo(365) })).eligible).toBe(true);
    expect(decide(stale({ lastActivityAt: daysAgo(364) })).eligible).toBe(false);
  });

  it("honours a custom window", () => {
    const state = stale({ lastActivityAt: daysAgo(45) });
    expect(decide(state, { retentionDays: 30 }).eligible).toBe(true);
    expect(decide(state, { retentionDays: 90 }).eligible).toBe(false);
  });

  it("is a no-op on an already-archived candidate, which is what makes the sweep idempotent", () => {
    expect(decide(stale({ archivedAt: daysAgo(5) }))).toEqual({
      eligible: false,
      reason: "ALREADY_ARCHIVED",
    });
  });

  it("skips erased shells — there is nothing left to move out of the way", () => {
    expect(decide(stale({ anonymisedAt: daysAgo(5) }))).toEqual({
      eligible: false,
      reason: "ANONYMISED",
    });
  });

  it("refuses to judge when there is no activity date at all", () => {
    // An unattended job acting on missing data is how you archive the whole pool by accident.
    expect(decide(stale({ lastActivityAt: null }))).toEqual({
      eligible: false,
      reason: "UNKNOWN_ACTIVITY",
    });
  });

  it("checks terminal states before the pipeline, so the reason given is the most useful one", () => {
    expect(decide(stale({ stages: ["SCREEN"], anonymisedAt: daysAgo(1) })).reason).toBe("ANONYMISED");
  });

  it("accepts a date string as well as a Date", () => {
    expect(decide(stale({ lastActivityAt: daysAgo(400).toISOString() })).eligible).toBe(true);
  });
});

describe("resolveRetentionDays", () => {
  it("reads a normal setting", () => {
    expect(resolveRetentionDays("180")).toBe(180);
    expect(resolveRetentionDays(90)).toBe(90);
  });

  it("falls back rather than letting a bad setting archive everybody", () => {
    // This value comes from a free-text settings row. "0" would mean "archive everyone, today".
    for (const bad of ["", "0", "-30", "abc", null, undefined, {}, NaN]) {
      expect(resolveRetentionDays(bad)).toBe(DEFAULT_RETENTION_DAYS);
    }
  });

  it("tolerates a sloppy but recoverable value", () => {
    expect(resolveRetentionDays("365 days")).toBe(365);
    expect(resolveRetentionDays(30.9)).toBe(30);
  });
});
