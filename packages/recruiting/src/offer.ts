// Compensation (M14) — the approved band on a requisition, and the offers written against it.
//
// Pure rules + input validation. No I/O: the ATS server actions enforce authorization and
// persistence on top of these decisions, and the DATABASE enforces who may read the rows at all
// (see the salary_band_access / offer_access policies). This file only knows what a legal offer
// looks like and how one relates to its band.
import { z } from "zod";

// Mirrors @hris/database PayBasis. Duplicated as a local `as const` tuple so this package keeps its
// single dependency (zod) — the same pattern as JOB_EMPLOYMENT_TYPES.
export const PAY_BASES = ["PER_HOUR", "PER_MONTH", "PER_YEAR"] as const;
export type PayBasisValue = (typeof PAY_BASES)[number];

export const OFFER_STATUSES = [
  "DRAFT",
  "EXTENDED",
  "ACCEPTED",
  "DECLINED",
  "SUPERSEDED",
] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

/**
 * The offer lifecycle.
 *
 *   DRAFT ──extend──▶ EXTENDED ──accept──▶ ACCEPTED   (terminal)
 *                         └────decline───▶ DECLINED
 *
 * The shape is M7's scorecard lifecycle — draft freely, lock on submit — because an offer has the
 * same property: it is a considered position right up until it leaves the building, and then it is
 * a commitment. Editing an extended offer in place would rewrite what the candidate was told.
 *
 * ACCEPTED is terminal, and SUPERSEDED is a resting state reached only by revision (below), never by
 * a direct move — which is why neither has any outgoing transition here.
 */
export const ALLOWED_OFFER_TRANSITIONS: Record<OfferStatus, readonly OfferStatus[]> = {
  DRAFT: ["EXTENDED"],
  EXTENDED: ["ACCEPTED", "DECLINED"],
  ACCEPTED: [],
  DECLINED: [],
  SUPERSEDED: [],
};

export function canTransitionOffer(from: OfferStatus, to: OfferStatus): boolean {
  return ALLOWED_OFFER_TRANSITIONS[from]?.includes(to) ?? false;
}

// Only a DRAFT may have its figures changed. Everything else is a matter of record.
export function canEditOffer(status: OfferStatus): boolean {
  return status === "DRAFT";
}

/**
 * May this offer be REVISED — superseded by a new version at a new number?
 *
 * Yes once it has been EXTENDED (they countered) or DECLINED (they said no, we improve it). Not
 * while it is still a DRAFT: there is nothing to preserve yet, so edit it. Not after ACCEPTED —
 * that is a signed agreement, and changing it is a new conversation, not a new version.
 *
 * A revision writes version N+1 rather than editing N, so "what did we first offer, and what did
 * they sign?" stays answerable. That question is the entire reason this table is versioned.
 */
export function canReviseOffer(status: OfferStatus): boolean {
  return status === "EXTENDED" || status === "DECLINED";
}

/**
 * Coerce to a real number, treating null / undefined / "" as ABSENT rather than as zero.
 *
 * ⚠️ The reason this helper exists: `Number(null)` is 0, and 0 is finite. Without it, an offer with
 * no salary yet classifies as BELOW the band — a missing figure would be reported as a lowball, and
 * the form would demand a written justification for a number nobody has typed. "Unknown" and "zero"
 * are different, and JavaScript's coercion rules do not agree.
 */
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Where an offer sits relative to its band. NO_BAND is distinct from IN_BAND on purpose: "we checked
// and it fits" and "there was nothing to check against" are different facts, and collapsing them
// would let an unbanded req quietly report every offer as compliant. It also covers the case where
// there is no figure to classify yet — either way, nothing was compared.
export const BAND_POSITIONS = ["BELOW", "IN_BAND", "ABOVE", "NO_BAND"] as const;
export type BandPosition = (typeof BAND_POSITIONS)[number];

export interface Band {
  salaryMin: number;
  salaryMax: number;
}

export interface OfferClassification {
  position: BandPosition;
  /** Offer ÷ band midpoint — the standard comp-ratio. null when there is no usable midpoint. */
  compaRatio: number | null;
}

/**
 * Classify an offer against its band, and compute the compa-ratio.
 *
 * The boundaries are INCLUSIVE: an offer exactly at the minimum or the maximum is IN_BAND. A band is
 * the range you are approved to hire in, and its endpoints are inside it — treating the max as
 * out-of-band would demand a written justification for using the range as approved.
 *
 * `compaRatio` returns null rather than a plausible-looking number whenever the midpoint is missing
 * or zero — the same "unknown is not 1.0" rule as averageRating and averageDays. A comp-ratio of 1.0
 * means "paid at midpoint", which is a real and reassuring claim; printing it for a req with no band
 * would be a lie in the most convincing possible form.
 */
export function classifyOffer(
  band: Band | null | undefined,
  salary: number | null | undefined,
): OfferClassification {
  const min = toNumber(band?.salaryMin);
  const max = toNumber(band?.salaryMax);
  const value = toNumber(salary);
  if (min === null || max === null || value === null) {
    return { position: "NO_BAND", compaRatio: null };
  }

  const midpoint = (min + max) / 2;
  const compaRatio = midpoint > 0 ? Math.round((value / midpoint) * 1000) / 1000 : null;

  if (value < min) return { position: "BELOW", compaRatio };
  if (value > max) return { position: "ABOVE", compaRatio };
  return { position: "IN_BAND", compaRatio };
}

// An offer outside its band needs a written justification. NO_BAND does not: there is no approval to
// have departed from, and demanding a reason for it would train people to type "n/a".
export function requiresOutOfBandReason(position: BandPosition): boolean {
  return position === "BELOW" || position === "ABOVE";
}

// The approved range on a requisition. min ≤ max is checked here rather than in the action so the
// form and the server cannot disagree about what a valid band is.
export const salaryBandSchema = z
  .object({
    salaryMin: z.coerce.number().positive("Enter a minimum above zero."),
    salaryMax: z.coerce.number().positive("Enter a maximum above zero."),
    currency: z.string().trim().length(3, "Use a 3-letter currency code.").toUpperCase(),
    payBasis: z.enum(PAY_BASES),
    postPublicly: z.coerce.boolean().default(false),
  })
  .refine((b) => b.salaryMin <= b.salaryMax, {
    path: ["salaryMax"],
    message: "The maximum must be at least the minimum.",
  });
export type SalaryBandInput = z.infer<typeof salaryBandSchema>;

/**
 * One offer version.
 *
 * ⚠️ `bandMin` / `bandMax` are NOT form fields. The caller supplies them from the requisition's band
 * as read from the database, never from the submitted payload — otherwise anyone could post a band
 * wide enough to make their offer "in band" and skip the justification. They live in the schema so
 * that the out-of-band rule sits in ONE place, shared by the form and the action, exactly like the
 * rejection-category rule in stageTransitionSchema.
 */
export const offerSchema = z
  .object({
    salary: z.coerce.number().positive("Enter a salary above zero."),
    currency: z.string().trim().length(3, "Use a 3-letter currency code.").toUpperCase(),
    payBasis: z.enum(PAY_BASES),
    startDate: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
      .optional(),
    notes: z.string().trim().max(2000).optional(),
    outOfBandReason: z.string().trim().max(2000).optional(),
    bandMin: z.coerce.number().optional(),
    bandMax: z.coerce.number().optional(),
  })
  .superRefine((value, ctx) => {
    const band =
      value.bandMin !== undefined && value.bandMax !== undefined
        ? { salaryMin: value.bandMin, salaryMax: value.bandMax }
        : null;
    const { position } = classifyOffer(band, value.salary);
    if (requiresOutOfBandReason(position) && !value.outOfBandReason) {
      ctx.addIssue({
        code: "custom",
        path: ["outOfBandReason"],
        message: "This offer is outside the approved band — say why.",
      });
    }
  });
export type OfferInput = z.infer<typeof offerSchema>;
