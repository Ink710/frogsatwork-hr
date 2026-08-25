import { sendMail } from "./transport.js";
import { candidateStageEmail } from "./templates.js";

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

  // THE CLAIM. Returns true only to the caller that won the row, so a retry, a double-submitted
  // form, or two recruiters moving the same application at once cannot all send. This is a database
  // decision (a unique index), not a read-then-write in application code, which would race.
  let claimed = false;
  try {
    const rows = await db.$queryRaw`SELECT app_claim_notification(${eventId}, 'EMAIL') AS claimed`;
    claimed = rows[0]?.claimed === true;
  } catch (e) {
    console.error("[notify] claim failed", { eventId, stageKey, error: e });
    return { sent: false, failed: true };
  }
  if (!claimed) return { sent: false, skipped: "ALREADY_SENT" };

  try {
    await sendMail({ to, subject: mail.subject, text: mail.text, html: mail.html });
  } catch (e) {
    // Expected in production, where no SMTP provider is configured. One line, with the cause.
    console.error("[notify] send failed", { eventId, stageKey, error: e?.message ?? e });
    await mark(db, eventId, "FAILED");
    return { sent: false, failed: true };
  }

  await mark(db, eventId, "SENT");
  return { sent: true };
}

// A failure to RECORD the outcome is not worth failing anything over — the message either went or it
// did not, and the row is already there in PENDING. Logged so a stuck PENDING is explainable.
async function mark(db, eventId, status) {
  try {
    await db.$queryRaw`SELECT app_mark_notification(${eventId}, 'EMAIL', ${status}) AS marked`;
  } catch (e) {
    console.error("[notify] could not record delivery status", { eventId, status, error: e });
  }
}
