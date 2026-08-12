import { describe, it, expect } from "vitest";
import {
  canTransition,
  nextStage,
  orderRounds,
  firstRound,
  nextRound,
  hasRemainingRounds,
} from "./rules";

describe("stage transitions", () => {
  it("allows each forward pipeline step", () => {
    expect(canTransition("APPLIED", "SCREEN")).toBe(true);
    expect(canTransition("SCREEN", "INTERVIEW")).toBe(true);
    expect(canTransition("INTERVIEW", "OFFER")).toBe(true);
    expect(canTransition("OFFER", "HIRED")).toBe(true);
  });

  it("allows reject/withdraw from any active stage", () => {
    for (const s of ["APPLIED", "SCREEN", "INTERVIEW", "OFFER"]) {
      expect(canTransition(s, "REJECTED")).toBe(true);
      expect(canTransition(s, "WITHDRAWN")).toBe(true);
    }
  });

  it("allows moving BACKWARD to any earlier active stage (Polish B)", () => {
    // "Actually, let's re-screen them" — a real thing recruiters do, which the pipeline previously
    // had no way to express. Every reversal still writes an ApplicationEvent.
    expect(canTransition("SCREEN", "APPLIED")).toBe(true);
    expect(canTransition("INTERVIEW", "SCREEN")).toBe(true);
    expect(canTransition("INTERVIEW", "APPLIED")).toBe(true);
    expect(canTransition("OFFER", "INTERVIEW")).toBe(true);
    expect(canTransition("OFFER", "APPLIED")).toBe(true);
  });

  it("allows a WITHDRAWN application to be reopened (M13)", () => {
    // A withdrawal is the CANDIDATE's decision and candidates change their minds. This assertion
    // was deliberately FLIPPED from `false` — see the pairing with REJECTED directly below.
    for (const s of ["APPLIED", "SCREEN", "INTERVIEW", "OFFER"]) {
      expect(canTransition("WITHDRAWN", s)).toBe(true);
    }
  });

  it("still forbids skipping stages and moving out of PERMANENT terminal states", () => {
    expect(canTransition("APPLIED", "OFFER")).toBe(false);
    expect(canTransition("APPLIED", "HIRED")).toBe(false);
    expect(canTransition("HIRED", "OFFER")).toBe(false);
    expect(canTransition("REJECTED", "APPLIED")).toBe(false);
    // Backward moves did NOT loosen the forward gate: reaching OFFER still requires an interview.
    expect(canTransition("SCREEN", "OFFER")).toBe(false);
    // REJECTED and HIRED stay permanent even though WITHDRAWN no longer is. The asymmetry is the
    // domain rule: a rejection is the COMPANY's decision, and undoing it would let the reason M12
    // records drift away from the decision it explains.
    expect(canTransition("HIRED", "APPLIED")).toBe(false);
    expect(canTransition("REJECTED", "SCREEN")).toBe(false);
    expect(canTransition("REJECTED", "APPLIED")).toBe(false);
  });

  it("nextStage walks the forward pipeline and stops at the end", () => {
    expect(nextStage("APPLIED")).toBe("SCREEN");
    expect(nextStage("OFFER")).toBe("HIRED");
    expect(nextStage("HIRED")).toBeNull();
    expect(nextStage("REJECTED")).toBeNull();
  });
});

describe("interview rounds", () => {
  const rounds = [
    { id: "c", position: 2 },
    { id: "a", position: 0 },
    { id: "b", position: 1 },
  ];

  it("orders by position without mutating the input", () => {
    const copy = [...rounds];
    expect(orderRounds(rounds).map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(rounds).toEqual(copy);
  });

  it("firstRound is the lowest position (or null when empty)", () => {
    expect(firstRound(rounds)?.id).toBe("a");
    expect(firstRound([])).toBeNull();
  });

  it("nextRound advances through the rounds and ends at null past the last", () => {
    expect(nextRound(rounds, null)?.id).toBe("a"); // not started → first
    expect(nextRound(rounds, "a")?.id).toBe("b");
    expect(nextRound(rounds, "b")?.id).toBe("c");
    expect(nextRound(rounds, "c")).toBeNull(); // at last round → ready for OFFER
    expect(nextRound(rounds, "unknown")?.id).toBe("a"); // unrecognized → treat as not started
  });
});

describe("hasRemainingRounds", () => {
  const ROUNDS = [
    { id: "r1", position: 0 },
    { id: "r2", position: 1 },
  ];

  it("is true before the sequence starts and mid-sequence", () => {
    expect(hasRemainingRounds(ROUNDS, null)).toBe(true);
    expect(hasRemainingRounds(ROUNDS, "r1")).toBe(true);
  });

  it("is false at the last round — the candidate is ready for Offer", () => {
    expect(hasRemainingRounds(ROUNDS, "r2")).toBe(false);
  });

  it("is false when the job defines no rounds at all", () => {
    // Nothing to wait for, so nothing to block: straight to Offer.
    expect(hasRemainingRounds([], null)).toBe(false);
  });

  it("treats an unrecognised current round as not started", () => {
    expect(hasRemainingRounds(ROUNDS, "gone")).toBe(true);
  });
});
