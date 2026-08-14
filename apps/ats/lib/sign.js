import crypto from "node:crypto";

// Short-lived signed résumé links — the ATS half of the pattern employee-records uses for employee
// documents (lib/sign.js there), and for the same reason: it is our local stand-in for an S3/R2
// presigned URL, so the shape of the code stays honest when a cloud driver replaces the local one.
//
// The link is bound to a specific CANDIDATE, a specific USER, and an expiry, HMAC-signed with
// AUTH_SECRET. Binding the user is what stops a link being useful to anyone else if it is pasted
// into a shared channel — a résumé outliving the session that fetched it is exactly the leak this
// prevents.
//
// ⚠️ This is defense in depth, NOT the gate. The route re-checks the session and reads the candidate
// through RLS, which is the real authority: a perfectly valid signature for someone you may not see
// still 404s.
//
// Keyed to the candidate rather than the application because the résumé lives on Candidate — one
// person, one CV, however many reqs they applied to.
const TTL_MS = 10 * 60 * 1000; // 10 minutes

function hmac(payload) {
  return crypto.createHmac("sha256", process.env.AUTH_SECRET ?? "").update(payload).digest("hex");
}

export function signResumeDownload(candidateId, userId, now = Date.now()) {
  const exp = now + TTL_MS;
  const sig = hmac(`${candidateId}.${userId}.${exp}`);
  return `/api/candidates/${candidateId}/resume?exp=${exp}&sig=${sig}`;
}

export function verifyResumeDownload(candidateId, userId, exp, sig, now = Date.now()) {
  if (!exp || !sig) return false;
  if (now > Number(exp)) return false;
  const expected = hmac(`${candidateId}.${userId}.${exp}`);
  const a = Buffer.from(String(sig));
  const b = Buffer.from(expected);
  // Length check first: timingSafeEqual throws on a length mismatch rather than returning false.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
