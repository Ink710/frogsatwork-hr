import { describe, it, expect } from "vitest";
import { campaignSlugSchema, campaignSchema, slugify, SOURCE_CHANNELS } from "./campaign";

const ok = (v) => campaignSlugSchema.safeParse(v).success;

describe("campaign slug rules", () => {
  it("accepts lowercase hyphen-separated words", () => {
    expect(ok("linkedin")).toBe(true);
    expect(ok("linkedin-march-grads")).toBe(true);
    expect(ok("q3-2026")).toBe(true);
  });

  it("rejects anything that could act as a path or a script", () => {
    // The slug arrives on a PUBLIC endpoint, so the shape is the security control: no dots and no
    // slashes means it can never be a path fragment, whatever the caller intends.
    expect(ok("../../etc/passwd")).toBe(false);
    expect(ok("linkedin/../admin")).toBe(false);
    expect(ok("<script>")).toBe(false);
    expect(ok("drop table")).toBe(false);
    expect(ok("campaign.name")).toBe(false);
  });

  it("rejects uppercase, so one campaign can't wear two spellings", () => {
    // ?source=LinkedIn and ?source=linkedin resolving to different campaigns would put two rows in
    // the report that a recruiter cannot tell apart.
    expect(ok("LinkedIn")).toBe(false);
  });

  it("rejects punctuation-only differences that would look identical in a list", () => {
    expect(ok("-linkedin")).toBe(false);
    expect(ok("linkedin-")).toBe(false);
    expect(ok("linkedin--grads")).toBe(false);
  });

  it("rejects an empty slug and one over the length cap", () => {
    expect(ok("")).toBe(false);
    expect(ok("   ")).toBe(false);
    expect(ok("a".repeat(41))).toBe(false);
    expect(ok("a".repeat(40))).toBe(true);
  });
});

describe("campaignSchema", () => {
  it("requires a known channel", () => {
    const base = { name: "LinkedIn — March grads", slug: "linkedin-march-grads" };
    expect(campaignSchema.safeParse({ ...base, channel: "LINKEDIN" }).success).toBe(true);
    expect(campaignSchema.safeParse({ ...base, channel: "TIKTOK" }).success).toBe(false);
    expect(campaignSchema.safeParse({ ...base, channel: "" }).success).toBe(false);
  });

  it("covers every channel the enum offers", () => {
    for (const channel of SOURCE_CHANNELS) {
      expect(campaignSchema.safeParse({ name: "n", slug: "s", channel }).success).toBe(true);
    }
  });
});

describe("slugify", () => {
  it("produces a slug the schema accepts", () => {
    for (const name of ["LinkedIn — March grads", "Referências 2026", "  Job Board (EU)  ", "Q3/Q4 push"]) {
      expect(ok(slugify(name))).toBe(true);
    }
  });

  it("keeps accented letters as letters rather than dropping them", () => {
    expect(slugify("Referências")).toBe("referencias");
  });

  it("never leaves a trailing hyphen, even when the length cap cuts mid-word", () => {
    // The slice can land right after a hyphen, which would fail the pattern the form is about to
    // validate against — so the suggestion would be born invalid.
    const suggestion = slugify(`${"a".repeat(39)} extra words here`);
    expect(suggestion.endsWith("-")).toBe(false);
    expect(ok(suggestion)).toBe(true);
  });
});
