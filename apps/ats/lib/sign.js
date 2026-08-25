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

// ── The CV a specific APPLICATION was submitted with (M7) ────────────────────────────────────
//
// The note above says the link is keyed to the candidate "because the résumé lives on Candidate —
// one person, one CV". That stopped being true in M7: an applicant can now replace their CV, so the
// key is pinned onto the application at submit and the two questions separate:
//
//   · signResumeDownload            → the CV we currently have for this person   (/candidates/[id])
//   · signApplicationResumeDownload → the CV they sent for THIS role             (an application)
//
// Both still exist because both are real questions. A recruiter looking at a person wants the
// current document; a recruiter reading an application must see what was actually reviewed, or the
// scorecard beside it is about a file nobody can produce any more.
//
// ⚠️ Separate HMAC payloads, deliberately. The two id spaces are different tables, and a shared
// signing format would mean a signature minted for a candidate id also validated for an application
// id that happened to match. It cannot happen with uuids, but the cost of preventing it is one
// prefix, and the cost of relying on "cannot happen" is a class of bug nobody looks for again.
export function signApplicationResumeDownload(applicationId, userId, now = Date.now()) {
  const exp = now + TTL_MS;
  const sig = hmac(`application.${applicationId}.${userId}.${exp}`);
  return `/api/applications/${applicationId}/resume?exp=${exp}&sig=${sig}`;
}

export function verifyApplicationResumeDownload(applicationId, userId, exp, sig, now = Date.now()) {
  if (!exp || !sig) return false;
  if (now > Number(exp)) return false;
  const expected = hmac(`application.${applicationId}.${userId}.${exp}`);
  const a = Buffer.from(String(sig));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
