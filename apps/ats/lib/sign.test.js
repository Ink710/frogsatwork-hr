import { describe, it, expect, beforeAll } from "vitest";
import {
  signResumeDownload,
  verifyResumeDownload,
  signApplicationResumeDownload,
  verifyApplicationResumeDownload,
} from "./sign.js";

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

// ── M7: the CV a specific APPLICATION was submitted with ───────────────────────────────────

describe("signed application-résumé links", () => {
  it("round-trips a valid signature", () => {
    const { exp, sig } = parse(signApplicationResumeDownload("app1", "user1"));
    expect(verifyApplicationResumeDownload("app1", "user1", exp, sig)).toBe(true);
  });

  it("points at the application route", () => {
    expect(signApplicationResumeDownload("app1", "user1")).toMatch(
      /^\/api\/applications\/app1\/resume\?/,
    );
  });

  it("is bound to both the application and the user", () => {
    const { exp, sig } = parse(signApplicationResumeDownload("app1", "user1"));
    expect(verifyApplicationResumeDownload("app2", "user1", exp, sig)).toBe(false);
    expect(verifyApplicationResumeDownload("app1", "user2", exp, sig)).toBe(false);
  });

  it("expires", () => {
    const past = Date.now() - 20 * 60 * 1000;
    const { exp, sig } = parse(signApplicationResumeDownload("app1", "user1", past));
    expect(verifyApplicationResumeDownload("app1", "user1", exp, sig)).toBe(false);
  });

  // ⚠️ THE REASON THE TWO PAYLOADS ARE PREFIXED DIFFERENTLY. Candidate ids and application ids live
  // in different tables; without the prefix, a signature minted for one id space would validate for
  // the other if the ids ever coincided. They are uuids, so it cannot happen — but the cost of
  // preventing it is one string, and the cost of relying on "cannot happen" is a bug class nobody
  // ever looks at again.
  it("does not accept a candidate signature for an application, or the reverse", () => {
    const fromCandidate = parse(signResumeDownload("same-id", "user1"));
    expect(
      verifyApplicationResumeDownload("same-id", "user1", fromCandidate.exp, fromCandidate.sig),
    ).toBe(false);

    const fromApplication = parse(signApplicationResumeDownload("same-id", "user1"));
    expect(verifyResumeDownload("same-id", "user1", fromApplication.exp, fromApplication.sig)).toBe(
      false,
    );
  });

  it("does not throw on a malformed signature", () => {
    const { exp } = parse(signApplicationResumeDownload("app1", "user1"));
    expect(() => verifyApplicationResumeDownload("app1", "user1", exp, "x")).not.toThrow();
    expect(verifyApplicationResumeDownload("app1", "user1", exp, "x")).toBe(false);
  });
});
