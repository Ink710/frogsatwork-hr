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
