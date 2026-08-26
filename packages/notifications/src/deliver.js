import { sendMail } from "./transport.js";
import { candidateStageEmail, interviewerSlotEmail } from "./templates.js";

// The claim → send → mark dance (M8), in one place because two apps do it: the ATS on a stage move,
// and both apply paths on the receipt.
//
// ⚠️ IT TAKES `db` RATHER THAN IMPORTING PRISMA. This package's whole value is being
// dependency-light — nodemailer only — so it calls doorways on whatever client it is handed. That
// also lets a caller pass a transaction if it ever needs to, and lets tests pass a stub.
//
// ⚠️ IT NEVER THROWS. Every caller runs this AFTER a transaction it must not disturb: the stage
// change (or the application) is already committed and is the fact that matters, while the email is
// a courtesy. A notification failure must never surface as a failed stage move.
//
// ⚠️ BUT IT ALWAYS LOGS. Three places in this suite once swallowed errors with a tidy `catch {}` and
// left the platform logs empty during a real outage. In production this suite has NO SMTP provider
// by design, so failure is the NORMAL path here — which is exactly why the log line must stay to one
// line with a cause, or it drowns the failures that do matter.

/**
 * Deliver one stage notification to one candidate, at most once.
 *
 * @param {object} args
 * @param {{ $queryRaw: Function }} args.db  a Prisma client (or transaction)
 * @param {string} args.eventId    the ApplicationEvent this is about — the idempotency key
 * @param {string} args.stageKey   APPLIED | SCREEN | INTERVIEW | OFFER | REJECTED
 * @param {string} args.to         the candidate's email
 * @param {string} args.firstName
 * @param {string} args.jobTitle
 * @param {string} [args.locale]   the CANDIDATE's locale — never the sender's
 * @param {string} args.portalUrl
 * @returns {Promise<{sent: boolean, skipped?: string, failed?: boolean}>}
 */
export async function deliverCandidateStageEmail({
  db,
  eventId,
  stageKey,
  to,
  firstName,
  jobTitle,
  locale,
  portalUrl,
}) {
  if (!eventId || !to) return { sent: false, skipped: "NO_RECIPIENT" };

  // Built BEFORE the claim: a stage with no copy must not burn the one claim that exists for this
  // event, or adding the template later would silently never send.
  const mail = candidateStageEmail({ stageKey, locale, firstName, jobTitle, portalUrl });
  if (!mail) return { sent: false, skipped: "NO_TEMPLATE" };

  return claimSendMark({
    db,
    subject: { eventId },
    to,
    mail,
    label: stageKey,
    // Candidate-facing: give them somewhere to reply. Staff mail below deliberately omits it.
    replyTo: process.env.RECRUITING_REPLY_TO,
  });
}

/**
 * Ask an interviewer to confirm a proposed slot (M9).
 *
 * ⚠️ THE FIRST NOTIFICATION IN THE SUITE ADDRESSED TO STAFF, which is why `recipientUserId` exists
 * and why the delivery row is keyed on the SLOT rather than an ApplicationEvent — an interviewer
 * confirmation is not an event about an application at all.
 *
 * @param {object} args
 * @param {{ $queryRaw: Function }} args.db
 * @param {string} args.slotId           the idempotency key
 * @param {string} args.recipientUserId  REQUIRED here: two different interviewers may each need
 *                                       telling about the same slot, so the recipient is part of
 *                                       what makes a delivery unique.
 * @param {string} args.when             already formatted by formatSlotWhen — it names its zone
 */
export async function deliverInterviewerSlotEmail({
  db,
  slotId,
  recipientUserId,
  to,
  firstName,
  jobTitle,
  roundName,
  when,
  confirmUrl,
  locale,
}) {
  if (!slotId || !to || !recipientUserId) return { sent: false, skipped: "NO_RECIPIENT" };

  const mail = interviewerSlotEmail({ firstName, jobTitle, roundName, when, confirmUrl, locale });
  return claimSendMark({ db, subject: { slotId, recipientUserId }, to, mail, label: "SLOT_CONFIRM" });
}

// ── The shared half ──────────────────────────────────────────────────────────────────────────
//
// Extracted when M9 added a second kind of notification, so the ORDER — claim, then send, then
// record — has one implementation. Getting that order wrong in one of two copies is exactly the kind
// of divergence that produces a duplicate email months later.
async function claimSendMark({ db, subject, to, mail, label, replyTo }) {
  const eventId = subject.eventId ?? null;
  const slotId = subject.slotId ?? null;
  const recipient = subject.recipientUserId ?? null;

  // THE CLAIM. Returns true only to the caller that won the row, so a retry, a double-submitted
  // form, or two recruiters acting at once cannot all send. This is a database decision (a unique
  // index), not a read-then-write in application code, which would race.
  let claimed = false;
  try {
    const rows = await db.$queryRaw`
      SELECT app_claim_notification(${eventId}, 'EMAIL', ${recipient}, ${slotId}) AS claimed`;
    claimed = rows[0]?.claimed === true;
  } catch (e) {
    console.error("[notify] claim failed", { eventId, slotId, label, error: e });
    return { sent: false, failed: true };
  }
  if (!claimed) return { sent: false, skipped: "ALREADY_SENT" };

  try {
    await sendMail({ to, subject: mail.subject, text: mail.text, html: mail.html, replyTo });
  } catch (e) {
    // Expected in production, where no SMTP provider is configured. One line, with the cause.
    console.error("[notify] send failed", { eventId, slotId, label, error: e?.message ?? e });
    await mark(db, eventId, slotId, recipient, "FAILED");
    return { sent: false, failed: true };
  }

  await mark(db, eventId, slotId, recipient, "SENT");
  return { sent: true };
}

// A failure to RECORD the outcome is not worth failing anything over — the message either went or it
// did not, and the row is already there in PENDING. Logged so a stuck PENDING is explainable.
async function mark(db, eventId, slotId, recipient, status) {
  try {
    await db.$queryRaw`
      SELECT app_mark_notification(${eventId}, 'EMAIL', ${status}, ${recipient}, ${slotId}) AS marked`;
  } catch (e) {
    console.error("[notify] could not record delivery status", { eventId, slotId, status, error: e });
  }
}
