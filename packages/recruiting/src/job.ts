// Recruiting (ATS) domain vocabulary + input validation for jobs and hiring teams. Enum tuples
// mirror the Prisma enums in @hris/database as local `as const` tuples so this package stays
// dependency-light (only zod) — the same pattern as @hris/workable-hours and @hris/types.
import { z } from "zod";
import { EEO_JOB_CATEGORIES } from "./eeo";

export const JOB_STATUSES = ["DRAFT", "OPEN", "PAUSED", "CLOSED", "FILLED"] as const;
export const JOB_MEMBER_ROLES = ["RECRUITER", "HIRING_MANAGER", "INTERVIEWER"] as const;
// Mirrors @hris/database EmploymentType — a job posts for one employment type.
export const JOB_EMPLOYMENT_TYPES = ["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN"] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];
export type JobMemberRole = (typeof JOB_MEMBER_ROLES)[number];

// Create / edit a job requisition.
export const jobSchema = z.object({
  title: z.string().trim().min(1, "Title is required."),
  description: z.string().trim().optional(),
  location: z.string().trim().optional(),
  employmentType: z.enum(JOB_EMPLOYMENT_TYPES),
  status: z.enum(JOB_STATUSES).default("DRAFT"),
  openings: z.coerce.number().int().min(1, "At least one opening."),
  departmentId: z.string().min(1).optional(),
  // EEO-1 category (M12). Optional, and never given a default: see the EeoJobCategory enum.
  eeoJobCategory: z.enum(EEO_JOB_CATEGORIES).optional(),
});
export type JobInput = z.infer<typeof jobSchema>;

// One interview round in a job's INTERVIEW phase.
export const interviewRoundSchema = z.object({
  name: z.string().trim().min(1, "Round name is required."),
  position: z.coerce.number().int().min(0),
});
export type InterviewRoundInput = z.infer<typeof interviewRoundSchema>;

// A job's ordered list of interview rounds (the per-job "form"). Positions must be unique.
export const interviewRoundsSchema = z
  .array(interviewRoundSchema)
  .max(12, "Keep it to 12 rounds or fewer.")
  .refine(
    (rounds) => new Set(rounds.map((r) => r.position)).size === rounds.length,
    "Round positions must be unique.",
  );

// Add someone to a job's hiring team.
export const jobMemberSchema = z.object({
  employeeId: z.string().min(1),
  role: z.enum(JOB_MEMBER_ROLES),
});
export type JobMemberInput = z.infer<typeof jobMemberSchema>;

// ── The screening call window (M13) ──────────────────────────────────────────────────────────
//
// When this req's recruiters make screening calls. Nobody self-books: the recruiter phones, and the
// window is the promise an applicant at SCREEN is shown so they know when to be reachable.
//
// ⚠️ A RECURRING WALL CLOCK, NOT AN INSTANT — the one place `Meeting`'s "HH:MM" idiom is right and
// `Shift`'s absolute timestamps are wrong, which is the exact reverse of the argument slot.ts makes
// for InterviewSlot. A window has no date; a timestamp would have to invent one.

const WALL_CLOCK_TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/** Minutes since midnight for a validated "HH:MM". Only meaningful after the regex has passed. */
function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}

/**
 * What a recruiter submits on /jobs/[id]/manage.
 *
 * ⚠️ ALL THREE OR NONE. Empty strings mean "clear the window" — that is what an emptied form sends,
 * and it must be a legitimate save rather than a validation error, or a window could never be
 * removed once set. Anything in between is refused: a half-set window renders an instruction
 * nobody can follow ("be available between 09:00 and —").
 *
 * This mirrors `Job_screening_call_window_ck` and is NOT the enforcement. The database refuses the
 * same states regardless of what any form decided, on the same principle that put required-answer
 * checking inside app_submit_application rather than in Zod alone. The two must agree; a test
 * asserts the interesting cases in both places.
 */
export const screeningWindowSchema = z
  .object({
    from: z.string().trim(),
    to: z.string().trim(),
    timeZone: z.string().trim(),
  })
  .refine(
    ({ from, to, timeZone }) => {
      const set = [from, to, timeZone].filter((v) => v !== "").length;
      return set === 0 || set === 3;
    },
    { message: "Set a start time, an end time and a time zone — or clear all three." },
  )
  .refine(({ from }) => from === "" || WALL_CLOCK_TIME.test(from), {
    message: "Start time must be a 24-hour time like 09:00.",
  })
  .refine(({ to }) => to === "" || WALL_CLOCK_TIME.test(to), {
    message: "End time must be a 24-hour time like 17:00.",
  })
  .refine(
    ({ from, to }) => from === "" || to === "" || minutesOfDay(from) < minutesOfDay(to),
    { message: "The end time must be later in the day than the start time." },
  );
export type ScreeningWindowInput = z.infer<typeof screeningWindowSchema>;

/** Is there a window to show at all? The portal renders nothing when there is not. */
export function hasScreeningWindow(window: {
  from?: string | null;
  to?: string | null;
  timeZone?: string | null;
}): boolean {
  return Boolean(window.from && window.to && window.timeZone);
}

/**
 * "09:00–17:00 (America/Mexico_City)" — the canonical rendering, used in the portal AND in email.
 *
 * ⚠️ THE ZONE IS ALWAYS NAMED, and it is not decoration: "between 9 and 5" is meaningless to a
 * candidate in another country, and this suite has one applicant-facing rule about times — say
 * which clock you mean. `formatSlotWhen` does the same for interview slots, and this deliberately
 * matches its 24-hour style so the two do not read as different systems on the same page.
 *
 * ⚠️ NO "YOUR LOCAL TIME" CONVERSION, unlike M9/M11's slots, and that is a decision rather than an
 * omission. Converting a wall clock needs a DATE to pick an offset from, and a recurring window has
 * none — anchoring on "today" would state the wrong hour for a call that happens after a clock
 * change. A labelled canonical time is always right; a helpfully converted one can be wrong on the
 * one day it matters, and the cost of that is a missed phone call.
 *
 * The formatting trick: the hours are placed on a FIXED UTC date and read back in UTC, so the
 * locale decides 24-hour vs am/pm styling while no zone conversion can occur.
 */
export function formatCallWindow(
  window: { from: string; to: string; timeZone: string },
  locale = "en",
): string {
  const at = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return new Intl.DateTimeFormat(locale, {
      timeZone: "UTC",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(Date.UTC(2000, 0, 1, h, m)));
  };
  return `${at(window.from)}–${at(window.to)} (${window.timeZone})`;
}
