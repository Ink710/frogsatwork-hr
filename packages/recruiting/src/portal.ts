// What an APPLICANT is shown about their own application (M5).
//
// This file is the entire disclosure decision, in one place, on purpose. The database decides what
// an applicant may SEE (app_applicant_applications / app_applicant_events); this decides what it is
// CALLED. Wording is a product decision that will change, and SQL is a bad place to iterate on copy.
//
// ⚠️ THE MAPPING IS 1:1 WITH THE INTERNAL PIPELINE, WHICH IS A DELIBERATE TRADE.
// Julian's design shows real movement — Applied, Screening, Interview, Offer — because an applicant
// staring at an unchanging "Received" for three weeks learns nothing and assumes the worst. The cost
// is that `ApplicationStage` becomes part of the PUBLIC surface: add a stage and it appears in every
// in-flight applicant's timeline; rename one and you have edited a page strangers read.
//
// That cost is bounded by the exhaustiveness guard below rather than by anybody remembering.
import type { ApplicationStage } from "./candidate";

export interface ApplicantStageView {
  /** i18n key suffix — the app renders `enum.applicantStage.<key>`. */
  key: string;
  /** Terminal states end the timeline; nothing follows them. */
  terminal: boolean;
  /** Only a REJECTED outcome carries the standard closing message. */
  closingMessage: boolean;
}

// ⚠️ EVERY ApplicationStage MUST HAVE AN ENTRY. `Record<ApplicationStage, …>` makes TypeScript
// complain when a stage is added, and portal.test.js fails the build for the same reason at runtime
// (the app is JS, so the type alone would not stop a deploy). Between them, ADDING A STAGE BREAKS
// THE BUILD UNTIL SOMEONE DECIDES WHAT APPLICANTS SHOULD SEE — which is the whole point: the
// decision becomes deliberate instead of shipping by default.
export const APPLICANT_STAGE_VIEW: Record<ApplicationStage, ApplicantStageView> = {
  APPLIED: { key: "APPLIED", terminal: false, closingMessage: false },
  SCREEN: { key: "SCREEN", terminal: false, closingMessage: false },
  INTERVIEW: { key: "INTERVIEW", terminal: false, closingMessage: false },
  OFFER: { key: "OFFER", terminal: false, closingMessage: false },
  HIRED: { key: "HIRED", terminal: true, closingMessage: false },
  // The outcome, never the internal reason. rejectionCategory is chosen in one click to feed
  // /reports; it is not written to be read by the person it describes.
  REJECTED: { key: "REJECTED", terminal: true, closingMessage: true },
  // Their own action — the standard "we've decided not to proceed" message would read absurdly.
  WITHDRAWN: { key: "WITHDRAWN", terminal: true, closingMessage: false },
};

// The neutral label for a stage we have no entry for. Unreachable while the guard holds, and that
// is exactly why it exists: if it ever IS reached, an applicant sees "In progress" rather than a raw
// enum key like `SKILLS_ASSESSMENT` leaking on a public page.
export const UNKNOWN_STAGE_VIEW: ApplicantStageView = {
  key: "UNKNOWN",
  terminal: false,
  closingMessage: false,
};

export function publicStatusFor(stage: string): ApplicantStageView {
  return APPLICANT_STAGE_VIEW[stage as ApplicationStage] ?? UNKNOWN_STAGE_VIEW;
}

export interface TimelineEntry {
  key: string;
  occurredAt: Date | string;
}

/**
 * Turn the raw event trail into what an applicant sees.
 *
 * ⚠️ CONSECUTIVE DUPLICATES COLLAPSE. Moving between interview ROUNDS writes an
 * INTERVIEW → INTERVIEW event each time (the seed has one), so an uncollapsed timeline prints
 * "Interview" twice with two dates and invites the reader to wonder what the second one meant. The
 * round names that would explain it are deliberately not exposed, so the honest rendering is one
 * entry, dated when they entered the stage.
 *
 * Keeps the FIRST occurrence, not the last: what matters is when they reached a stage, not when we
 * last touched it.
 */
export function buildApplicantTimeline(
  events: readonly { toStage: string; occurredAt: Date | string }[],
): TimelineEntry[] {
  const ordered = [...events].sort(
    (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
  );

  const out: TimelineEntry[] = [];
  for (const e of ordered) {
    const { key } = publicStatusFor(e.toStage);
    if (out.length > 0 && out[out.length - 1].key === key) continue;
    out.push({ key, occurredAt: e.occurredAt });
  }
  return out;
}

/** Stage keys in pipeline order, for rendering a progress indicator. Exits are not steps. */
export const APPLICANT_PROGRESS_KEYS = ["APPLIED", "SCREEN", "INTERVIEW", "OFFER", "HIRED"] as const;
