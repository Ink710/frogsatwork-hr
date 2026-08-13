import { describe, it, expect } from "vitest";
import {
  ALLOWED_OFFER_TRANSITIONS,
  canTransitionOffer,
  canEditOffer,
  canReviseOffer,
  classifyOffer,
  requiresOutOfBandReason,
  salaryBandSchema,
  offerSchema,
  OFFER_STATUSES,
} from "./offer";

const BAND = { salaryMin: 120000, salaryMax: 160000 }; // midpoint 140000

describe("the offer lifecycle", () => {
  it("walks draft → extended → accepted", () => {
    expect(canTransitionOffer("DRAFT", "EXTENDED")).toBe(true);
    expect(canTransitionOffer("EXTENDED", "ACCEPTED")).toBe(true);
    expect(canTransitionOffer("EXTENDED", "DECLINED")).toBe(true);
  });

  it("never lets a draft skip straight to accepted — an offer must be made before it is taken", () => {
    expect(canTransitionOffer("DRAFT", "ACCEPTED")).toBe(false);
    expect(canTransitionOffer("DRAFT", "DECLINED")).toBe(false);
  });

  it("treats ACCEPTED and SUPERSEDED as terminal", () => {
    expect(ALLOWED_OFFER_TRANSITIONS.ACCEPTED).toEqual([]);
    expect(ALLOWED_OFFER_TRANSITIONS.SUPERSEDED).toEqual([]);
    for (const to of OFFER_STATUSES) {
      expect(canTransitionOffer("ACCEPTED", to)).toBe(false);
      expect(canTransitionOffer("SUPERSEDED", to)).toBe(false);
    }
  });

  it("allows edits ONLY while a draft", () => {
    expect(canEditOffer("DRAFT")).toBe(true);
    for (const s of ["EXTENDED", "ACCEPTED", "DECLINED", "SUPERSEDED"]) {
      expect(canEditOffer(s)).toBe(false);
    }
  });

  it("allows revision after it was extended or declined, but never before or after that", () => {
    expect(canReviseOffer("EXTENDED")).toBe(true);
    expect(canReviseOffer("DECLINED")).toBe(true);
    // A draft has nothing worth preserving yet — edit it instead of versioning it.
    expect(canReviseOffer("DRAFT")).toBe(false);
    // An accepted offer is an agreement; changing it is a new conversation, not a new version.
    expect(canReviseOffer("ACCEPTED")).toBe(false);
    expect(canReviseOffer("SUPERSEDED")).toBe(false);
  });
});

describe("classifyOffer", () => {
  it("places an offer inside the band and computes the compa-ratio against the midpoint", () => {
    expect(classifyOffer(BAND, 140000)).toEqual({ position: "IN_BAND", compaRatio: 1 });
    expect(classifyOffer(BAND, 133000)).toEqual({ position: "IN_BAND", compaRatio: 0.95 });
  });

  it("treats BOTH boundaries as inside the band", () => {
    // Using the range as approved must never require a written justification.
    expect(classifyOffer(BAND, 120000).position).toBe("IN_BAND");
    expect(classifyOffer(BAND, 160000).position).toBe("IN_BAND");
    expect(classifyOffer(BAND, 119999.99).position).toBe("BELOW");
    expect(classifyOffer(BAND, 160000.01).position).toBe("ABOVE");
  });

  it("still reports the compa-ratio for an out-of-band offer — that is when it matters most", () => {
    expect(classifyOffer(BAND, 175000)).toEqual({ position: "ABOVE", compaRatio: 1.25 });
    expect(classifyOffer(BAND, 105000)).toEqual({ position: "BELOW", compaRatio: 0.75 });
  });

  it("distinguishes 'no band to check against' from 'checked and it fits'", () => {
    expect(classifyOffer(null, 150000)).toEqual({ position: "NO_BAND", compaRatio: null });
    expect(classifyOffer(undefined, 150000).position).toBe("NO_BAND");
  });

  it("returns compaRatio null rather than a convincing-looking number when it cannot be computed", () => {
    // 1.0 reads as "paid at midpoint" — a real claim. Never print it for a guess.
    expect(classifyOffer({ salaryMin: 0, salaryMax: 0 }, 150000).compaRatio).toBeNull();
    expect(classifyOffer(BAND, null).compaRatio).toBeNull();
    expect(classifyOffer(BAND, Number.NaN).position).toBe("NO_BAND");
  });

  it("demands a justification only when the offer actually departed from an approved band", () => {
    expect(requiresOutOfBandReason("BELOW")).toBe(true);
    expect(requiresOutOfBandReason("ABOVE")).toBe(true);
    expect(requiresOutOfBandReason("IN_BAND")).toBe(false);
    expect(requiresOutOfBandReason("NO_BAND")).toBe(false);
  });
});

describe("salaryBandSchema", () => {
  const valid = { salaryMin: "120000", salaryMax: "160000", currency: "usd", payBasis: "PER_YEAR" };

  it("coerces the numbers and upper-cases the currency", () => {
    const parsed = salaryBandSchema.parse(valid);
    expect(parsed).toMatchObject({ salaryMin: 120000, salaryMax: 160000, currency: "USD" });
    expect(parsed.postPublicly).toBe(false); // posting a range is never the default
  });

  it("rejects an inverted range", () => {
    const r = salaryBandSchema.safeParse({ ...valid, salaryMin: "160000", salaryMax: "120000" });
    expect(r.success).toBe(false);
    expect(r.error.issues[0].path).toEqual(["salaryMax"]);
  });

  it("allows a single-point band (min === max)", () => {
    expect(salaryBandSchema.safeParse({ ...valid, salaryMax: "120000" }).success).toBe(true);
  });
});

describe("offerSchema", () => {
  const base = { salary: "150000", currency: "USD", payBasis: "PER_YEAR" };
  const withBand = { bandMin: 120000, bandMax: 160000 };

  it("accepts an in-band offer with no justification", () => {
    expect(offerSchema.safeParse({ ...base, ...withBand }).success).toBe(true);
  });

  it("REFUSES an out-of-band offer with no justification", () => {
    const r = offerSchema.safeParse({ ...base, salary: "185000", ...withBand });
    expect(r.success).toBe(false);
    expect(r.error.issues[0].path).toEqual(["outOfBandReason"]);
  });

  it("accepts an out-of-band offer once it is justified", () => {
    const r = offerSchema.safeParse({
      ...base,
      salary: "185000",
      ...withBand,
      outOfBandReason: "Counter-offer from their current employer; approved by the VP.",
    });
    expect(r.success).toBe(true);
  });

  it("asks for nothing extra when the req has no band at all", () => {
    expect(offerSchema.safeParse({ ...base, salary: "999999" }).success).toBe(true);
  });

  it("validates the start date shape", () => {
    expect(offerSchema.safeParse({ ...base, ...withBand, startDate: "2026-09-01" }).success).toBe(true);
    expect(offerSchema.safeParse({ ...base, ...withBand, startDate: "01/09/2026" }).success).toBe(false);
  });
});
