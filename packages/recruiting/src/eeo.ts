// Voluntary EEO self-identification (M10) — vocabulary, validation, and the suppression rule that
// keeps a small aggregate from becoming an identification.
//
// The ACCESS boundary for this data is not here: it's in SQL (EeoResponse has row-level security
// with no policies, and app_eeo_summary is gated on HR_ADMIN). What lives here is the arithmetic and
// the ethics of PRESENTING an aggregate — deliberately, because a threshold you can't unit-test is a
// threshold nobody trusts, and an access rule written in JavaScript is one an attacker skips.
import { z } from "zod";

export const EEO_GENDERS = ["MALE", "FEMALE", "NON_BINARY", "DECLINED"] as const;
export type EeoGender = (typeof EEO_GENDERS)[number];

export const EEO_ETHNICITIES = [
  "HISPANIC_OR_LATINO",
  "WHITE",
  "BLACK_OR_AFRICAN_AMERICAN",
  "ASIAN",
  "NATIVE_HAWAIIAN_OR_PACIFIC_ISLANDER",
  "AMERICAN_INDIAN_OR_ALASKA_NATIVE",
  "TWO_OR_MORE_RACES",
  "DECLINED",
] as const;
export type EeoEthnicity = (typeof EEO_ETHNICITIES)[number];

export const EEO_VETERAN_STATUSES = ["PROTECTED_VETERAN", "NOT_A_VETERAN", "DECLINED"] as const;
export type EeoVeteranStatus = (typeof EEO_VETERAN_STATUSES)[number];

export const EEO_DISABILITY_STATUSES = ["YES", "NO", "DECLINED"] as const;
export type EeoDisabilityStatus = (typeof EEO_DISABILITY_STATUSES)[number];

/**
 * The ten EEO-1 Component 1 job categories (M12), in the order the form lists them.
 *
 * A requisition's category is nullable and never defaulted: an EEO-1 filed with a guessed category
 * is a misfiled EEO-1, so an unset one is surfaced as a warning on the export rather than quietly
 * bucketed somewhere plausible.
 */
export const EEO_JOB_CATEGORIES = [
  "EXECUTIVE_SENIOR_OFFICIALS",
  "FIRST_MID_OFFICIALS",
  "PROFESSIONALS",
  "TECHNICIANS",
  "SALES_WORKERS",
  "ADMINISTRATIVE_SUPPORT",
  "CRAFT_WORKERS",
  "OPERATIVES",
  "LABORERS_HELPERS",
  "SERVICE_WORKERS",
] as const;
export type EeoJobCategory = (typeof EEO_JOB_CATEGORIES)[number];

/** The two export artifacts. See the eeo_export migration for why there are two. */
export const EEO_EXPORT_VARIANTS = ["SUMMARY", "FILING"] as const;
export type EeoExportVariant = (typeof EEO_EXPORT_VARIANTS)[number];

/** The four dimensions, in the order the form asks them and the report renders them. */
export const EEO_DIMENSIONS = ["gender", "ethnicity", "veteranStatus", "disabilityStatus"] as const;
export type EeoDimension = (typeof EEO_DIMENSIONS)[number];

/** Every dimension's allowed values, keyed by dimension — one lookup for both the form and the report. */
export const EEO_VALUES: Record<EeoDimension, readonly string[]> = {
  gender: EEO_GENDERS,
  ethnicity: EEO_ETHNICITIES,
  veteranStatus: EEO_VETERAN_STATUSES,
  disabilityStatus: EEO_DISABILITY_STATUSES,
};

/**
 * The voluntary section of the public application form.
 *
 * Every field defaults to DECLINED, and an unrecognised value is COERCED to DECLINED rather than
 * rejected — because this data is optional and the application is not. A malformed demographic
 * answer must never be the reason someone's application fails. (app_submit_application makes the
 * same choice independently in SQL; neither layer relies on the other.)
 */
const declining = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .enum(values)
    .catch(values[values.length - 1] as T[number])
    .default(values[values.length - 1] as T[number]);

export const eeoResponseSchema = z.object({
  gender: declining(EEO_GENDERS),
  ethnicity: declining(EEO_ETHNICITIES),
  veteranStatus: declining(EEO_VETERAN_STATUSES),
  disabilityStatus: declining(EEO_DISABILITY_STATUSES),
});
export type EeoResponseInput = z.infer<typeof eeoResponseSchema>;

/**
 * Minimum cell size. Below this, a count is withheld.
 *
 * Five is the conventional floor in demographic reporting. The reasoning is blunt: in an applicant
 * pool of thirty, "1 candidate identified as X" plus a hiring manager's memory of who interviewed
 * that week is an identification, not a statistic.
 */
export const EEO_MIN_CELL = 5;

export interface EeoCount {
  dimension: string;
  value: string;
  responses: number;
}

export interface EeoCell {
  value: string;
  /** The count, or null when withheld to protect anonymity. */
  responses: number | null;
  suppressed: boolean;
}

export interface EeoDimensionSummary {
  dimension: string;
  cells: EeoCell[];
  /** Total responses in this dimension — always safe to show, and always the sum of the raw cells. */
  total: number;
  /** True when at least one cell is withheld, so the UI can explain the gaps rather than hide them. */
  hasSuppression: boolean;
}

/**
 * Apply small-cell suppression to raw per-dimension counts.
 *
 * Two rules, and the second is the one that's easy to miss:
 *
 *   1. Any non-zero cell below `min` is withheld. (Zero is not withheld — "nobody selected this" is
 *      not identifying, and blanking it would imply we're hiding someone.)
 *   2. If exactly ONE cell ends up withheld, the next-smallest is withheld too — COMPLEMENTARY
 *      suppression. Otherwise the hidden number is recoverable in one subtraction: the dimension
 *      total is shown, every other cell is shown, so the "protected" figure is simply what's left
 *      over. A suppression that can be undone with arithmetic is decoration, not protection.
 *
 * Rows for a dimension arrive already grouped by the caller; unknown dimensions pass through, so a
 * fifth question added later needs no change here.
 */
export function suppressSmallCells(
  rows: EeoCount[],
  { min = EEO_MIN_CELL }: { min?: number } = {},
): EeoDimensionSummary[] {
  const byDimension = new Map<string, EeoCount[]>();
  for (const row of rows) {
    const bucket = byDimension.get(row.dimension) ?? [];
    bucket.push(row);
    byDimension.set(row.dimension, bucket);
  }

  return [...byDimension.entries()].map(([dimension, counts]) => {
    const total = counts.reduce((sum, c) => sum + c.responses, 0);

    // Rule 1.
    const hidden = new Set(
      counts.filter((c) => c.responses > 0 && c.responses < min).map((c) => c.value),
    );

    // Rule 2 — a lone suppressed cell hides nothing, so take the next-smallest with it. Ties are
    // broken by value so the choice is deterministic and a re-render never moves the gap around.
    if (hidden.size === 1) {
      const next = counts
        .filter((c) => !hidden.has(c.value) && c.responses > 0)
        .sort((a, b) => a.responses - b.responses || a.value.localeCompare(b.value))[0];
      if (next) hidden.add(next.value);
    }

    return {
      dimension,
      total,
      hasSuppression: hidden.size > 0,
      cells: counts
        .sort((a, b) => b.responses - a.responses || a.value.localeCompare(b.value))
        .map((c) => ({
          value: c.value,
          responses: hidden.has(c.value) ? null : c.responses,
          suppressed: hidden.has(c.value),
        })),
    };
  });
}
