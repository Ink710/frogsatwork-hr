import crypto from "node:crypto";

// Short-lived signed download links (our local stand-in for S3/R2 presigned URLs). The
// link is bound to a specific document AND user AND expiry, HMAC-signed with AUTH_SECRET.
// The download route re-checks the session + RLS too — this is defense in depth, not the
// only gate.
const TTL_MS = 10 * 60 * 1000; // 10 minutes

function hmac(payload) {
  return crypto.createHmac("sha256", process.env.AUTH_SECRET ?? "").update(payload).digest("hex");
}

export function signDownload(docId, userId, now = Date.now()) {
  const exp = now + TTL_MS;
  const sig = hmac(`${docId}.${userId}.${exp}`);
  return `/api/documents/${docId}/download?exp=${exp}&sig=${sig}`;
}

export function verifyDownload(docId, userId, exp, sig, now = Date.now()) {
  if (!exp || !sig) return false;
  if (now > Number(exp)) return false;
  const expected = hmac(`${docId}.${userId}.${exp}`);
  const a = Buffer.from(String(sig));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
