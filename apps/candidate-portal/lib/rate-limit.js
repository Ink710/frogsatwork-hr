import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Throttling for the ONE public write this app has: requesting a login link.
//
// Same shape as the other apps' limiters (fixed window, analytics off, ephemeral cache, IP-only
// keys so no PII ever reaches Redis) and env-gated the same way — with the Upstash vars unset, this
// is a transparent no-op and the flow behaves exactly as it does in production without it.
//
// Tight limits are SAFE here for the same reason they are on the erasure endpoint: this endpoint
// answers identically whether or not it found anything, so a throttled attacker learns nothing they
// were going to learn anyway. What the limit actually protects is the mail path — without it, one
// script could use us to send unlimited email to a harvested address list.
const ATTEMPTS = 5;
const WINDOW = "10 m";

let limiter = null;
function getLimiter() {
  if (limiter) return limiter;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  limiter = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.fixedWindow(ATTEMPTS, WINDOW),
    analytics: false,
    ephemeralCache: new Map(),
    // Namespaced per app: the suite may share one Upstash database, and a shared prefix would mean
    // a shared counter.
    prefix: "portal:login",
  });
  return limiter;
}

export async function allowLoginLinkRequest(identifier) {
  const rl = getLimiter();
  if (!rl) return true;
  const { success } = await rl.limit(identifier);
  return success;
}

// The PUBLIC apply endpoint gets its own budget — more generous than a login link, because a real
// applicant may legitimately retry a failed submission or apply to several roles in one sitting,
// but still far below what a spam bot wants. Same fixed window, same single counter, same env gate.
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
    prefix: "portal:apply",
  });
  return applyLimiter;
}

export async function allowApplyAttempt(identifier) {
  const rl = getApplyLimiter();
  if (!rl) return true;
  const { success } = await rl.limit(identifier);
  return success;
}

// Profile writes (M7), including replacing a CV.
//
// ⚠️ KEYED BY ACCOUNT ID, NOT IP — the only limiter here that is. The other two throttle strangers,
// where an IP is the only handle there is; this one throttles someone we have already identified, so
// an IP key would be both weaker (one person, many addresses) and worse (one address, many people —
// an office or a campus sharing a NAT would throttle each other).
//
// What it protects is object storage: a session no longer bounds file writes, so without this one
// account could push 5 MB at the blob store in a loop. Generous, because saving a profile repeatedly
// while editing it is ordinary behaviour, not abuse.
const PROFILE_ATTEMPTS = 20;
const PROFILE_WINDOW = "10 m";

let profileLimiter = null;
function getProfileLimiter() {
  if (profileLimiter) return profileLimiter;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  profileLimiter = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.fixedWindow(PROFILE_ATTEMPTS, PROFILE_WINDOW),
    analytics: false,
    ephemeralCache: new Map(),
    prefix: "portal:profile",
  });
  return profileLimiter;
}

export async function allowProfileWrite(identifier) {
  const rl = getProfileLimiter();
  if (!rl) return true;
  const { success } = await rl.limit(identifier);
  return success;
}
