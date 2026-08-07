import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// ── Login rate limiting ──────────────────────────────────────────────────────
// Throttles login attempts to blunt password guessing / credential stuffing.
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
    prefix: "tm:login", // namespaced so it can't collide with other keys on the DB
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

// The PUBLIC careers apply endpoint — the one route reachable without an account, so it gets its own
// budget. Slightly more generous than login (a real applicant may legitimately retry a failed
// submission or apply to several roles) but still far below what a spam bot wants. Same fixed-window,
// same single counter, same env gate.
const APPLY_ATTEMPTS = 8;
const APPLY_WINDOW = "10 m";
let applyLimiter = null;

function getApplyLimiter() {
  if (applyLimiter) return applyLimiter;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  applyLimiter = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.fixedWindow(APPLY_ATTEMPTS, APPLY_WINDOW),
    analytics: false,
    ephemeralCache: new Map(),
    prefix: "tm:apply",
  });
  return applyLimiter;
}

export async function allowApplyAttempt(identifier) {
  const rl = getApplyLimiter();
  if (!rl) return true;
  const { success } = await rl.limit(identifier);
  return success;
}
