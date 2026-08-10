// Interview feedback: vocabulary, validation, and the pure rules that decide when a scorecard is
// good enough to submit. Kept out of the form so "you must rate every competency" is a testable
// rule rather than something buried in JSX.
import { z } from "zod";

export const SCORECARD_STATUSES = ["DRAFT", "SUBMITTED"] as const;
export const RECOMMENDATIONS = ["STRONG_YES", "YES", "NO", "STRONG_NO"] as const;

export type ScorecardStatus = (typeof SCORECARD_STATUSES)[number];
export type Recommendation = (typeof RECOMMENDATIONS)[number];

// 1–4 with no neutral middle, matching the Recommendation enum's reasoning: a rater who can sit on
// the fence usually does, and a debrief needs signal.
export const RATING_MIN = 1;
export const RATING_MAX = 4;
export const RATING_SCALE = [1, 2, 3, 4] as const;

// A criterion the job scores on (per-job, ordered — the InterviewRound shape).
export const competencySchema = z.object({
  name: z.string().trim().min(1, "Competency name is required.").max(120),
  position: z.coerce.number().int().min(0),
});
export type CompetencyInput = z.infer<typeof competencySchema>;

// One competency's score inside a scorecard.
export const scorecardRatingSchema = z.object({
  competencyId: z.string().min(1),
  rating: z.coerce.number().int().min(RATING_MIN, "Pick a rating.").max(RATING_MAX),
  comment: z.string().trim().max(1000).optional(),
});

// Saving a DRAFT is permissive on purpose — half-finished notes are the normal state of a scorecard
// during an interview. The completeness rules only bite at submit time (see isScorecardComplete).
export const scorecardDraftSchema = z.object({
  recommendation: z.enum(RECOMMENDATIONS).optional(),
  notes: z.string().trim().max(5000).optional(),
  ratings: z.array(scorecardRatingSchema).max(50),
});
export type ScorecardDraftInput = z.infer<typeof scorecardDraftSchema>;

/**
 * Is this scorecard ready to submit? Every competency the job defines must be rated, and the author
 * must commit to a recommendation. Pure so it can be unit-tested and reused by both the action and
 * the UI's disabled state.
 *
 * @returns { ok: true } | { ok: false, reason: "MISSING_RECOMMENDATION" | "MISSING_RATINGS", missing: string[] }
 */
export function isScorecardComplete(
  competencies: readonly { id: string; name: string }[],
  ratings: readonly { competencyId: string; rating?: number | null }[],
  recommendation?: string | null,
) {
  if (!recommendation) return { ok: false as const, reason: "MISSING_RECOMMENDATION" as const, missing: [] };

  const rated = new Set(
    ratings.filter((r) => typeof r.rating === "number" && r.rating >= RATING_MIN).map((r) => r.competencyId),
  );
  const missing = competencies.filter((c) => !rated.has(c.id)).map((c) => c.name);
  if (missing.length > 0) return { ok: false as const, reason: "MISSING_RATINGS" as const, missing };

  return { ok: true as const };
}

// Average score across a submitted scorecard — the one number a debrief screen can sort on. Null
// when nothing is rated (never fabricate a 0, which would read as "terrible" rather than "unknown").
export function averageRating(ratings: readonly { rating: number }[]): number | null {
  if (ratings.length === 0) return null;
  const sum = ratings.reduce((acc, r) => acc + r.rating, 0);
  return Math.round((sum / ratings.length) * 10) / 10;
}
