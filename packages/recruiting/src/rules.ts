// Pure recruiting rules — no I/O, no zod. The single source of truth for how the hiring pipeline may
// advance and how a job's interview rounds are ordered. Unit-tested; consumed by the ATS server
// actions (which also enforce authorization + persistence on top of these decisions).
import type { ApplicationStage } from "./candidate";

// The pipeline. Three rules, and the asymmetry between the first two is deliberate:
//
//   1. FORWARD, one step at a time. You cannot skip to OFFER without an interview — that gate is a
//      real hiring control, not an accident of the data model.
//   2. BACKWARD, to ANY earlier active stage. Added in Polish B, because "actually, let's re-screen
//      them" is something recruiters do constantly and the pipeline had no way to express it. Every
//      such move still writes an ApplicationEvent, so a reversal is visible in the trail rather than
//      looking like the candidate was never there.
//   3. HIRED and REJECTED are PERMANENT — no outgoing transitions. That is what makes a rejection's
//      recorded reason permanent (M12): re-considering someone means a new application, not an
//      edited one.
//   4. WITHDRAWN is REVERSIBLE (M13), and the asymmetry with REJECTED is the point. A withdrawal is
//      the CANDIDATE's decision, and candidates change their minds — "actually, I'm still
//      interested" is an ordinary thing to hear. A rejection is the COMPANY's decision, and letting
//      it be undone would let its recorded reason drift away from the decision it explains.
//
// From any active stage you may also REJECT or WITHDRAW.
export const ALLOWED_STAGE_TRANSITIONS: Record<ApplicationStage, readonly ApplicationStage[]> = {
  APPLIED: ["SCREEN", "REJECTED", "WITHDRAWN"],
  SCREEN: ["APPLIED", "INTERVIEW", "REJECTED", "WITHDRAWN"],
  INTERVIEW: ["APPLIED", "SCREEN", "OFFER", "REJECTED", "WITHDRAWN"],
  OFFER: ["APPLIED", "SCREEN", "INTERVIEW", "HIRED", "REJECTED", "WITHDRAWN"],
  HIRED: [],
  REJECTED: [],
  WITHDRAWN: ["APPLIED", "SCREEN", "INTERVIEW", "OFFER"],
};

// May an application move from `from` to `to`?
export function canTransition(from: ApplicationStage, to: ApplicationStage): boolean {
  return ALLOWED_STAGE_TRANSITIONS[from]?.includes(to) ?? false;
}

// The natural forward next stage (ignoring reject/withdraw), or null at a terminal end.
const FORWARD: Partial<Record<ApplicationStage, ApplicationStage>> = {
  APPLIED: "SCREEN",
  SCREEN: "INTERVIEW",
  INTERVIEW: "OFFER",
  OFFER: "HIRED",
};
export function nextStage(from: ApplicationStage): ApplicationStage | null {
  return FORWARD[from] ?? null;
}

// --- Interview rounds: the per-job ordered sub-steps of the INTERVIEW phase ---

export interface Round {
  id: string;
  position: number;
}

// Rounds sorted by position (ascending). Never mutates the input.
export function orderRounds<T extends Round>(rounds: readonly T[]): T[] {
  return [...rounds].sort((a, b) => a.position - b.position);
}

// The first round to enter when an application reaches INTERVIEW, or null if the job defines none.
export function firstRound<T extends Round>(rounds: readonly T[]): T | null {
  return orderRounds(rounds)[0] ?? null;
}

// The next round after `currentRoundId`, or null when already at the last round (→ ready for OFFER).
// A null or unrecognized current id is treated as "not started" and returns the first round.
export function nextRound<T extends Round>(
  rounds: readonly T[],
  currentRoundId: string | null,
): T | null {
  const ordered = orderRounds(rounds);
  if (!currentRoundId) return ordered[0] ?? null;
  const idx = ordered.findIndex((r) => r.id === currentRoundId);
  if (idx === -1) return ordered[0] ?? null;
  return ordered[idx + 1] ?? null;
}

/**
 * Are there interview rounds still to run for this application?
 *
 * The guard on leaving INTERVIEW for OFFER (Polish B). The stage buttons have always expressed this
 * implicitly — while rounds remain the card offers "Next round" and never "Advance to Offer" — but a
 * DRAG has no such implicit path, so the rule has to become something both surfaces can ask.
 *
 * A job with no rounds defined returns false: nothing to wait for, go straight to Offer.
 */
export function hasRemainingRounds<T extends Round>(
  rounds: readonly T[],
  currentRoundId: string | null,
): boolean {
  return rounds.length > 0 && nextRound(rounds, currentRoundId) !== null;
}
