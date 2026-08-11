// Candidate retention (M11) — the pure rule deciding when someone drops out of the active talent
// pool. No I/O and no Prisma: the sweep does the (RLS-scoped) fetching, this decides. Kept separate
// because "who gets archived automatically" is exactly the kind of rule that must be readable and
// testable without standing up a database and waiting a year.
//
// Archiving is NOT erasure — see app_erase_candidate. Nothing here destroys anything; the worst a
// wrong answer does is hide someone from a default list until a recruiter ticks a checkbox. That
// reversibility is what makes it safe to automate at all.
import { daysBetween } from "./reporting";

/** Stages where a candidate is still live in a pipeline. Never archived, however quiet they've been. */
export const ACTIVE_STAGES = ["APPLIED", "SCREEN", "INTERVIEW", "OFFER"] as const;

/**
 * Days of inactivity before a candidate is archived, when the AppSetting is missing or unusable.
 * A year: long enough that a real talent pool stays useful, short enough to mean something.
 */
export const DEFAULT_RETENTION_DAYS = 365;

export type ArchiveIneligibility =
  | "ACTIVE_PIPELINE"
  | "TOO_RECENT"
  | "ALREADY_ARCHIVED"
  | "ANONYMISED"
  | "UNKNOWN_ACTIVITY";

export interface ArchiveCandidateState {
  /** Newest ApplicationEvent across all their applications; the caller falls back to createdAt. */
  lastActivityAt: Date | string | null;
  /** Current stage of every application they have. */
  stages: readonly string[];
  archivedAt?: Date | string | null;
  anonymisedAt?: Date | string | null;
}

export interface ArchiveDecision {
  eligible: boolean;
  /** Why not, when `eligible` is false. null when it is. */
  reason: ArchiveIneligibility | null;
}

/**
 * Read the retention window out of its AppSetting string.
 *
 * Defensive on purpose. This value comes from a free-text settings row a human edits, and it is the
 * single input that decides how much of the talent pool disappears. A typo — "", "0", "-30",
 * "365 days" — must not be able to archive everybody, so anything that isn't a positive whole number
 * falls back to the default rather than being coerced into one.
 */
export function resolveRetentionDays(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_RETENTION_DAYS;
}

/**
 * Should this candidate be archived?
 *
 * The checks are ordered cheapest-and-most-absolute first, and the order is also the priority we'd
 * want in an explanation: already-archived and anonymised are terminal states, an active pipeline
 * beats any amount of silence, and only then does the clock matter.
 */
export function isEligibleForArchive(
  state: ArchiveCandidateState,
  { now = new Date(), retentionDays = DEFAULT_RETENTION_DAYS }: { now?: Date; retentionDays?: number } = {},
): ArchiveDecision {
  if (state.archivedAt) return { eligible: false, reason: "ALREADY_ARCHIVED" };

  // An erased shell has nothing left to move out of the way, and archiving it would only muddy
  // what the tombstone in the UI is telling you.
  if (state.anonymisedAt) return { eligible: false, reason: "ANONYMISED" };

  // Live in a pipeline → never archived. Someone sitting at OFFER for eight months is a problem for
  // the requisition-aging report to raise, not something to quietly hide from the recruiter.
  // (HIRED is deliberately absent from ACTIVE_STAGES: they're an employee now, their record lives in
  // employee-records, and the talent pool is no longer where they belong.)
  if (state.stages.some((s) => (ACTIVE_STAGES as readonly string[]).includes(s))) {
    return { eligible: false, reason: "ACTIVE_PIPELINE" };
  }

  // No activity date at all means we can't judge the clock — so we don't. Refusing to act on missing
  // data is the right default for an automated job that runs unattended.
  if (!state.lastActivityAt) return { eligible: false, reason: "UNKNOWN_ACTIVITY" };

  const idleDays = daysBetween(state.lastActivityAt, now);
  if (idleDays < retentionDays) return { eligible: false, reason: "TOO_RECENT" };

  return { eligible: true, reason: null };
}
