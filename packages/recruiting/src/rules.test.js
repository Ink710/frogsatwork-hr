import { describe, it, expect } from "vitest";
import { canTransition, nextStage, orderRounds, firstRound, nextRound } from "./rules";

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

  it("forbids skipping stages and moving out of terminal states", () => {
    expect(canTransition("APPLIED", "OFFER")).toBe(false);
    expect(canTransition("APPLIED", "HIRED")).toBe(false);
    expect(canTransition("HIRED", "OFFER")).toBe(false);
    expect(canTransition("REJECTED", "APPLIED")).toBe(false);
    expect(canTransition("WITHDRAWN", "SCREEN")).toBe(false);
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
