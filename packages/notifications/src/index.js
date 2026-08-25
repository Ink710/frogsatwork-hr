import nodemailer from "nodemailer";

// Outbound email for the suite.
//
// This package existed as an EMPTY STUB from the start; M4 is the first milestone that needed a
// second app to send mail, which is the trigger apps/employee-records/lib/email.js names in its own
// comment ("promote to a shared @hris/email package once the ATS also needs to send mail").
//
// ⚠️ SCOPE NOTE: employee-records still has its own copy. Moving it onto this package is M8's job,
// deliberately — M4 has no business editing an app it isn't otherwise touching, and a refactor of a
// working invite flow is exactly the kind of change that should ship with its own tests rather than
// riding along with an auth milestone.
//
// In dev SMTP_HOST points at the Mailpit container (SMTP :1025, inbox at http://localhost:8025); in
// production the same variables point at a real provider, so no code changes are needed.

// One transport, created lazily and reused. `secure:false` = plain SMTP (Mailpit and most providers
// upgrade to STARTTLS on the same port); Mailpit needs no auth.
let transport;
function getTransport() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 1025),
      secure: false,
    });
  }
  return transport;
}

export const DEFAULT_FROM = "FrogsAtWorkHR <no-reply@frogsatwork.test>";

/**
 * Send one message. Thin on purpose: this package owns the TRANSPORT, and each app owns the words
 * it sends, because copy is product surface and belongs next to the feature that needs it.
 *
 * Throws on failure rather than swallowing. Callers decide what a failure means — for a login link
 * it must NOT become a signal to the user (see the sign-in action), but the caller can only make
 * that choice if it hears about the failure at all. A tidy catch here would recreate the blind spot
 * that left the platform logs empty during a real outage.
 */
export async function sendMail({ to, subject, text, html, from = DEFAULT_FROM }) {
  await getTransport().sendMail({ from: process.env.SMTP_FROM ?? from, to, subject, text, html });
}
