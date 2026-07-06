import "server-only";
import nodemailer from "nodemailer";

// Outbound email. In dev this points at the Mailpit container (SMTP :1025, read at
// http://localhost:8025); in production the same env vars point at a real provider, so no
// code changes are needed. Kept app-local for now — promote to a shared @hris/email package
// once the ATS also needs to send mail.

// One transport, created lazily and reused. `secure:false` = plain SMTP (Mailpit and most
// providers upgrade to STARTTLS on the same port); Mailpit needs no auth.
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

export async function sendInviteEmail({ to, name, link }) {
  await getTransport().sendMail({
    from: process.env.SMTP_FROM ?? "PeopleBase <no-reply@peoplebase.test>",
    to,
    subject: "Set up your PeopleBase account",
    text:
      `Hi ${name},\n\n` +
      `An account was created for you in PeopleBase. Set your password to sign in:\n` +
      `${link}\n\n` +
      `This link expires in 7 days. If it has expired, ask HR to send a new one.`,
    html:
      `<p>Hi ${name},</p>` +
      `<p>An account was created for you in PeopleBase. Set your password to sign in:</p>` +
      `<p><a href="${link}">Set your password</a></p>` +
      `<p style="color:#71717a;font-size:13px">This link expires in 7 days. ` +
      `If it has expired, ask HR to send a new one.</p>`,
  });
}
