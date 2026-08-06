// Pure recruiting rules — no I/O, no zod. The single source of truth for how the hiring pipeline may
// advance and how a job's interview rounds are ordered. Unit-tested; consumed by the ATS server
// actions (which also enforce authorization + persistence on top of these decisions).
import type { ApplicationStage } from "./candidate";

// The fixed pipeline. From any ACTIVE stage you may also REJECT or WITHDRAW. Terminal stages
// (HIRED / REJECTED / WITHDRAWN) have no outgoing transitions.
export const ALLOWED_STAGE_TRANSITIONS: Record<ApplicationStage, readonly ApplicationStage[]> = {
  APPLIED: ["SCREEN", "REJECTED", "WITHDRAWN"],
  SCREEN: ["INTERVIEW", "REJECTED", "WITHDRAWN"],
  INTERVIEW: ["OFFER", "REJECTED", "WITHDRAWN"],
  OFFER: ["HIRED", "REJECTED", "WITHDRAWN"],
  HIRED: [],
  REJECTED: [],
  WITHDRAWN: [],
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
