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
  /**
   * Whether reaching this stage sends the applicant a message (M8).
   *
   * ⚠️ IT LIVES HERE, ON THE SAME RECORD AS THE DISCLOSURE DECISION, AND THAT IS THE POINT. The
   * exhaustiveness guard below already fails the build when a stage is added — putting `notify`
   * anywhere else would mean a new stage could ship with a decided LABEL and an undecided
   * NOTIFICATION, silently defaulting to either emailing strangers or telling them nothing.
   */
  notify: boolean;
}

// ⚠️ EVERY ApplicationStage MUST HAVE AN ENTRY. `Record<ApplicationStage, …>` makes TypeScript
// complain when a stage is added, and portal.test.js fails the build for the same reason at runtime
// (the app is JS, so the type alone would not stop a deploy). Between them, ADDING A STAGE BREAKS
// THE BUILD UNTIL SOMEONE DECIDES WHAT APPLICANTS SHOULD SEE — which is the whole point: the
// decision becomes deliberate instead of shipping by default.
export const APPLICANT_STAGE_VIEW: Record<ApplicationStage, ApplicantStageView> = {
  // Notified: the receipt. The most expected message in hiring, and the one whose absence is most
  // noticed. Written from the apply path, keyed on the APPLIED event that submission creates.
  APPLIED: { key: "APPLIED", terminal: false, closingMessage: false, notify: true },
  SCREEN: { key: "SCREEN", terminal: false, closingMessage: false, notify: true },
  INTERVIEW: { key: "INTERVIEW", terminal: false, closingMessage: false, notify: true },
  OFFER: { key: "OFFER", terminal: false, closingMessage: false, notify: true },
  // NOT notified: by the time an application is marked HIRED the person has accepted an offer and
  // heard from a human. An automated "you've been hired" would arrive after the fact and read as a
  // machine catching up. app_link_hire also closes their portal account in the same statement.
  HIRED: { key: "HIRED", terminal: true, closingMessage: false, notify: false },
  // The outcome, never the internal reason. rejectionCategory is chosen in one click to feed
  // /reports; it is not written to be read by the person it describes.
  //
  // ⚠️ Notified BOTH by email and in the portal, and the copy is M5's existing courtesy message,
  // reused verbatim. Never interpolate `rejectionReason` or `rejectionCategory` into it: those are
  // written by recruiters for colleagues, and a rejection email is a document the person keeps.
  REJECTED: { key: "REJECTED", terminal: true, closingMessage: true, notify: true },
  // Their own action — the standard "we've decided not to proceed" message would read absurdly, and
  // mailing someone about a thing they just did themselves is worse than silence.
  WITHDRAWN: { key: "WITHDRAWN", terminal: true, closingMessage: false, notify: false },
};

// The neutral label for a stage we have no entry for. Unreachable while the guard holds, and that
// is exactly why it exists: if it ever IS reached, an applicant sees "In progress" rather than a raw
// enum key like `SKILLS_ASSESSMENT` leaking on a public page.
export const UNKNOWN_STAGE_VIEW: ApplicantStageView = {
  key: "UNKNOWN",
  terminal: false,
  closingMessage: false,
  // ⚠️ Fails CLOSED. A stage nobody has decided about must not generate mail to a stranger; showing
  // "In progress" and saying nothing is the safe half of an unreachable branch.
  notify: false,
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
