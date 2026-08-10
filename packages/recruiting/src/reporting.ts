// Pure reporting maths. No I/O and no Prisma — the queries do the (RLS-scoped) counting, these
// functions turn counts into the numbers a recruiter reads. Kept separate so the arithmetic that's
// easy to get subtly wrong (conversion rates, averages over empty sets) is unit-testable.

// The funnel, in order. REJECTED / WITHDRAWN are exits, not stages, so they never appear here.
export const FUNNEL_STAGES = ["APPLIED", "SCREEN", "INTERVIEW", "OFFER", "HIRED"] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export interface FunnelRow {
  stage: FunnelStage;
  /** Applications that EVER reached this stage — not those currently sitting in it. */
  reached: number;
  /** Percent of the previous stage that got here. null for the first stage (nothing precedes it). */
  conversionFromPrevious: number | null;
  /** Applications that reached the previous stage but not this one. null for the first stage. */
  dropOff: number | null;
}

/**
 * Build the funnel from per-stage "ever reached" counts.
 *
 * The counts MUST be "ever reached", not "currently at". A candidate sitting at OFFER also passed
 * Screen and Interview; counting them only once, at the end, makes every drop-off figure fiction.
 * That's why these numbers come from the append-only ApplicationEvent trail rather than
 * Application.stage.
 */
export function buildFunnel(reached: Partial<Record<FunnelStage, number>>): FunnelRow[] {
  return FUNNEL_STAGES.map((stage, i) => {
    const count = reached[stage] ?? 0;
    if (i === 0) return { stage, reached: count, conversionFromPrevious: null, dropOff: null };

    const prev = reached[FUNNEL_STAGES[i - 1]] ?? 0;
    // No one reached the previous stage → conversion is undefined, not 0%. Reporting "0%" for an
    // empty pipeline reads as failure when the truth is "no data".
    if (prev === 0) return { stage, reached: count, conversionFromPrevious: null, dropOff: null };

    // Clamp at 100: data can legitimately go sideways (someone moved straight to OFFER by a manual
    // correction), and a 130% conversion rate destroys trust in every other number on the page.
    const conversion = Math.min(100, Math.round((count / prev) * 1000) / 10);
    return {
      stage,
      reached: count,
      conversionFromPrevious: conversion,
      dropOff: Math.max(0, prev - count),
    };
  });
}

/** Whole days between two instants, floored at 0. */
export function daysBetween(from: Date | string, to: Date | string): number {
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/**
 * Average of a set of day-counts, to one decimal — with the sample size, because "18 days" from two
 * hires is a very different claim from "18 days" over two hundred, and a report that hides n invites
 * false confidence. null (never 0) when there's nothing to average.
 */
export function averageDays(values: readonly number[]): { days: number | null; sample: number } {
  if (values.length === 0) return { days: null, sample: 0 };
  const sum = values.reduce((acc, v) => acc + v, 0);
  return { days: Math.round((sum / values.length) * 10) / 10, sample: values.length };
}

export interface SourceRow {
  source: string;
  applications: number;
  hires: number;
  /** Percent of this source's applications that became hires. null when it has none yet. */
  hireRate: number | null;
}

/**
 * Roll up applications and hires by source. Sorted by hires first, then volume: the question a
 * recruiter is actually asking is "which source produces PEOPLE", not "which produces traffic".
 */
export function summariseSources(
  rows: readonly { source: string | null; applications: number; hires: number }[],
): SourceRow[] {
  return rows
    .map((r) => ({
      source: r.source ?? "Unknown",
      applications: r.applications,
      hires: r.hires,
      hireRate: r.applications > 0 ? Math.round((r.hires / r.applications) * 1000) / 10 : null,
    }))
    .sort((a, b) => b.hires - a.hires || b.applications - a.applications || a.source.localeCompare(b.source));
}
