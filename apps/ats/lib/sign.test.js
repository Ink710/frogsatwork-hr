import { describe, it, expect, beforeAll } from "vitest";
import { signResumeDownload, verifyResumeDownload } from "./sign.js";

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret";
});

const parse = (url) => Object.fromEntries(new URLSearchParams(url.split("?")[1]));

describe("signed résumé links", () => {
  it("round-trips a valid signature", () => {
    const { exp, sig } = parse(signResumeDownload("cand1", "user1"));
    expect(verifyResumeDownload("cand1", "user1", exp, sig)).toBe(true);
  });

  it("points at the candidate's own route", () => {
    expect(signResumeDownload("cand1", "user1")).toMatch(/^\/api\/candidates\/cand1\/resume\?/);
  });

  it("rejects a tampered signature", () => {
    const { exp } = parse(signResumeDownload("cand1", "user1"));
    expect(verifyResumeDownload("cand1", "user1", exp, "deadbeef")).toBe(false);
  });

  it("is bound to the exact candidate AND user", () => {
    // The user binding is the one that matters most: it's what stops a link pasted into a shared
    // channel from working for whoever finds it.
    const { exp, sig } = parse(signResumeDownload("cand1", "user1"));
    expect(verifyResumeDownload("cand2", "user1", exp, sig)).toBe(false); // different candidate
    expect(verifyResumeDownload("cand1", "user2", exp, sig)).toBe(false); // different user
  });

  it("rejects an expired link", () => {
    const past = Date.now() - 20 * 60 * 1000; // signed 20 min ago; TTL is 10
    const { exp, sig } = parse(signResumeDownload("cand1", "user1", past));
    expect(verifyResumeDownload("cand1", "user1", exp, sig)).toBe(false);
  });

  it("rejects a missing signature or expiry outright", () => {
    expect(verifyResumeDownload("cand1", "user1", null, null)).toBe(false);
    expect(verifyResumeDownload("cand1", "user1", Date.now() + 1000, undefined)).toBe(false);
  });

  it("does not throw when the signature is the wrong LENGTH", () => {
    // timingSafeEqual throws on a length mismatch rather than returning false, so the length guard
    // in verify is load-bearing — without it a short `?sig=x` is a 500 instead of a 403.
    const { exp } = parse(signResumeDownload("cand1", "user1"));
    expect(() => verifyResumeDownload("cand1", "user1", exp, "x")).not.toThrow();
    expect(verifyResumeDownload("cand1", "user1", exp, "x")).toBe(false);
  });
});
