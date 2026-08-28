import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * The login limiter (M14) — the first test any of the suite's four limiters has had.
 *
 * ⚠️ WHAT THIS DELIBERATELY DOES NOT DO: talk to Upstash. The value of a test here is not
 * re-verifying that @upstash/ratelimit counts correctly; it is pinning the two behaviours THIS
 * codebase depends on and could break without noticing:
 *
 *   1. With the env vars absent the limiter is a transparent no-op — Redis is never constructed, and
 *      login behaves exactly as it did before M14. This is what makes shipping the limiter safe
 *      ahead of configuring Upstash on the Vercel project, and it is load-bearing for every
 *      existing test and local dev run, none of which have Upstash.
 *   2. With them present it defers to the library and returns its verdict unchanged — in particular
 *      it must return FALSE on a throttle rather than throwing, because the caller redirects.
 *
 * The module caches its limiter in a module-scoped variable, so every test resets the registry.
 */

const REAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

afterEach(() => {
  process.env = { ...REAL_ENV };
  vi.restoreAllMocks();
});

describe("when Upstash is not configured", () => {
  it("allows every attempt, and never constructs a Redis client", async () => {
    const Redis = vi.fn();
    vi.doMock("@upstash/redis", () => ({ Redis }));
    vi.doMock("@upstash/ratelimit", () => ({ Ratelimit: vi.fn() }));

    const { allowLoginAttempt } = await import("./rate-limit.js");

    for (let i = 0; i < 20; i++) {
      expect(await allowLoginAttempt("203.0.113.7")).toBe(true);
    }
    // The point of the env gate: no Redis connection is even attempted.
    expect(Redis).not.toHaveBeenCalled();
  });

  it("allows an attempt when only ONE of the two vars is set", async () => {
    // A half-configured deploy is a real state — someone pastes the URL and forgets the token.
    // Failing OPEN is the deliberate choice: a throttle that cannot reach Redis must not lock
    // everyone out of the HR system.
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    const Redis = vi.fn();
    vi.doMock("@upstash/redis", () => ({ Redis }));
    vi.doMock("@upstash/ratelimit", () => ({ Ratelimit: vi.fn() }));

    const { allowLoginAttempt } = await import("./rate-limit.js");
    expect(await allowLoginAttempt("203.0.113.7")).toBe(true);
    expect(Redis).not.toHaveBeenCalled();
  });
});

describe("when Upstash IS configured", () => {
  async function loadWithVerdicts(verdicts) {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "token";
    const limit = vi.fn(async () => ({ success: verdicts.shift() }));
    const Ratelimit = vi.fn(function () {
      this.limit = limit;
    });
    Ratelimit.fixedWindow = vi.fn(() => "fixed-window");
    vi.doMock("@upstash/redis", () => ({ Redis: vi.fn() }));
    vi.doMock("@upstash/ratelimit", () => ({ Ratelimit }));
    const mod = await import("./rate-limit.js");
    return { ...mod, limit, Ratelimit };
  }

  it("returns the library's verdict, including FALSE rather than throwing", async () => {
    const { allowLoginAttempt, limit } = await loadWithVerdicts([true, true, false]);
    expect(await allowLoginAttempt("198.51.100.4")).toBe(true);
    expect(await allowLoginAttempt("198.51.100.4")).toBe(true);
    // The caller redirects on false; a throw here would surface as a 500 on the login page.
    expect(await allowLoginAttempt("198.51.100.4")).toBe(false);
    expect(limit).toHaveBeenCalledTimes(3);
  });

  it("keys on the identifier it is given and nothing else", async () => {
    // ⚠️ No email, no password, no user id — only the IP reaches Redis. Keeping PII out of the
    // rate-limit store is a stated design constraint, and this is the line that enforces it.
    const { allowLoginAttempt, limit } = await loadWithVerdicts([true]);
    await allowLoginAttempt("198.51.100.4");
    expect(limit).toHaveBeenCalledWith("198.51.100.4");
  });

  it("uses a fixed window and an er:-prefixed key space", async () => {
    // The three apps share one Upstash database; a shared prefix would mean a shared counter, so
    // throttling an ATS login would throttle employee-records too.
    const { allowLoginAttempt, Ratelimit } = await loadWithVerdicts([true]);
    await allowLoginAttempt("198.51.100.4");
    const config = Ratelimit.mock.calls[0][0];
    expect(config.prefix).toBe("er:login");
    expect(config.analytics).toBe(false);
    expect(Ratelimit.fixedWindow).toHaveBeenCalled();
  });

  it("builds the limiter once and reuses it across attempts", async () => {
    // The ephemeral cache only helps if the instance survives; rebuilding per call would also mean
    // a new Redis client per login attempt.
    const { allowLoginAttempt, Ratelimit } = await loadWithVerdicts([true, true, true]);
    await allowLoginAttempt("a");
    await allowLoginAttempt("b");
    await allowLoginAttempt("c");
    expect(Ratelimit).toHaveBeenCalledTimes(1);
  });
});
