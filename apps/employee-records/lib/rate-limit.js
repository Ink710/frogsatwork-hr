import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// ── Login rate limiting ──────────────────────────────────────────────────────
// Throttles login attempts to blunt password guessing / credential stuffing.
//
// ⚠️ ADDED IN M14, AND THIS APP WAS THE ONE WITHOUT IT. The ATS and time-management have
// gated their logins on this since they shipped; employee-records — the app with the most
// sensitive data in the suite — called signIn() with nothing in front of it. The ATS
// limiter's own comment already named this app as sharing the Upstash database, so the
// per-app prefix below was reserved for a limiter that did not exist.
//
// Deliberately a COPY rather than a shared package: each app owns its own budget and
// prefix, and the three files are meant to be readable side by side. If a fourth reason
// to change all of them appears, that is the moment to extract it — not before.
//
// Design goal (per Julian): keep Redis usage at the bare operational minimum.
//   • Fixed window (not sliding): a single auto-expiring integer counter per key
//     — the smallest possible payload and ONE Redis command per attempt.
//   • analytics: false      → we don't write the extra per-request analytics keys.
//   • ephemeralCache (Map)  → once a key is blocked, further attempts on the same
//     warm serverless instance are refused from memory, WITHOUT touching Redis.
//   • Key = client IP only  → a short string; no email/PII ever stored in Redis.
//
// Env-gated: if the Upstash vars are absent (local dev, tests, or a deploy that
// simply hasn't configured it), this is a transparent no-op — Redis is never
// contacted and login behaves exactly as before.

const ATTEMPTS = 5; // allowed login attempts…
const WINDOW = "60 s"; // …per rolling fixed window, per IP.

// Reused across warm invocations so the ephemeral cache actually accumulates.
let limiter = null;

function getLimiter() {
  if (limiter) return limiter;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null; // not configured → disabled

  limiter = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.fixedWindow(ATTEMPTS, WINDOW),
    analytics: false,
    ephemeralCache: new Map(),
    prefix: "er:login", // namespaced PER APP: employee-records, time-management and the ATS
    // may share one Upstash database, and a shared prefix would mean a shared counter.
  });
  return limiter;
}

/**
 * @param {string} identifier - the caller's client IP (or "unknown").
 * @returns {Promise<boolean>} true if the attempt is allowed, false if throttled.
 *   When Upstash isn't configured, always returns true (disabled).
 */
export async function allowLoginAttempt(identifier) {
  const rl = getLimiter();
  if (!rl) return true;
  const { success } = await rl.limit(identifier);
  return success;
}
