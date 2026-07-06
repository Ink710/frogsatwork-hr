import { describe, it, expect, beforeAll } from "vitest";
import { signDownload, verifyDownload } from "./sign.js";

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret";
});

const parse = (url) => Object.fromEntries(new URLSearchParams(url.split("?")[1]));

describe("signed download URLs", () => {
  it("round-trips a valid signature", () => {
    const { exp, sig } = parse(signDownload("doc1", "user1"));
    expect(verifyDownload("doc1", "user1", exp, sig)).toBe(true);
  });

  it("rejects a tampered signature", () => {
    const { exp } = parse(signDownload("doc1", "user1"));
    expect(verifyDownload("doc1", "user1", exp, "deadbeef")).toBe(false);
  });

  it("is bound to the exact doc AND user", () => {
    const { exp, sig } = parse(signDownload("doc1", "user1"));
    expect(verifyDownload("doc2", "user1", exp, sig)).toBe(false); // different doc
    expect(verifyDownload("doc1", "user2", exp, sig)).toBe(false); // different user
  });

  it("rejects an expired link", () => {
    const past = Date.now() - 20 * 60 * 1000; // signed 20 min ago (TTL is 10)
    const { exp, sig } = parse(signDownload("doc1", "user1", past));
    expect(verifyDownload("doc1", "user1", exp, sig)).toBe(false);
  });
});
