import "server-only";
import { sendMail } from "@hris/notifications";

// New-hire invite email.
//
// ⚠️ THE TRANSPORT MOVED, THE WORDS DID NOT (M8). This file used to build its own nodemailer
// transport, duplicating the one in `@hris/notifications` — the promotion its old comment asked for
// ("promote to a shared @hris/email package once the ATS also needs to send mail"), and which that
// package's own comment named as M8's job.
//
// What was NOT moved is `sendInviteEmail` itself. `@hris/notifications` owns the TRANSPORT; each app
// owns the words it sends, because copy is product surface and belongs beside the feature that needs
// it. An invite is employee-records' message about employee-records' onboarding flow, so it stays
// here — only the plumbing underneath it is now shared.
//
// (M8 does add candidate-facing templates to the package, which is a deliberate exception with its
// own reasoning: those are sent by TWO apps to the same audience. See the package.)
//
// Dev still points at the Mailpit container (SMTP :1025, inbox at http://localhost:8025); production
// points the same variables at a real provider, with no code change.

export async function sendInviteEmail({ to, name, link }) {
  await sendMail({
    to,
    subject: "Set up your FrogsAtWorkHR account",
    text:
      `Hi ${name},\n\n` +
      `An account was created for you in FrogsAtWorkHR. Set your password to sign in:\n` +
      `${link}\n\n` +
      `This link expires in 7 days. If it has expired, ask HR to send a new one.`,
    html:
      `<p>Hi ${name},</p>` +
      `<p>An account was created for you in FrogsAtWorkHR. Set your password to sign in:</p>` +
      `<p><a href="${link}">Set your password</a></p>` +
      `<p style="color:#71717a;font-size:13px">This link expires in 7 days. ` +
      `If it has expired, ask HR to send a new one.</p>`,
  });
}
