import "server-only";
import crypto from "node:crypto";

// One-time login links.
//
// The same primitive as the staff invite flow (apps/employee-records/lib/invite.js): a 256-bit
// random token, of which the database stores ONLY the SHA-256 hash. Unlike the HMAC links in the
// ATS's sign.js this needs no signing secret — the token IS the secret, and comparing hashes means
// a database leak yields no usable link.
//
// ⚠️ THE TTL IS THIRTY MINUTES, NOT THE INVITE'S SEVEN DAYS. An invite is an onboarding errand that
// a new hire may get to tomorrow; this is a live credential that grants a session the moment it is
// clicked. A link sitting in an inbox — or in a mail provider's logs, or a forwarded thread — is a
// standing key to someone's application history, so it should stop working while they are still
// reading the email.
export const LOGIN_TTL_MS = 30 * 60 * 1000;

export function hashLoginToken(raw) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function generateLoginToken(now = Date.now()) {
  // base64url so it survives a URL untouched — no percent-encoding to mangle in a mail client.
  const raw = crypto.randomBytes(32).toString("base64url");
  return { raw, hash: hashLoginToken(raw), expires: new Date(now + LOGIN_TTL_MS) };
}

export function loginLink(rawToken) {
  const base = process.env.APP_BASE_URL ?? "http://localhost:3003";
  return `${base}/sign-in/verify?token=${rawToken}`;
}
