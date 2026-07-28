// Attendance / clock rules (M4). Pure — no I/O, no framework — so the pairing + variance arithmetic
// is unit-tested in isolation and safe to import from client or server. The ClockEvent ledger is the
// only stored fact; everything here (sessions, worked hours, schedule variance) is DERIVED at read
// time, which is why nothing needs to be kept in sync.
import { z } from "zod";
import { hoursBetween } from "./hours";

export const CLOCK_EVENT_TYPES = ["IN", "OUT"] as const;
export type ClockEventType = (typeof CLOCK_EVENT_TYPES)[number];

// The derived per-day verdicts. NONE = nothing to show (no punches, no scheduled shift).
// ON_LEAVE is NOT produced by computeAttendanceDay (which is leave-unaware) — it's part of the
// vocabulary so a roster view can OVERRIDE a cell when an approved leave covers the day (a planned
// absence, not an exception). See getTeamAttendanceWeek (M11).
export const ATTENDANCE_STATUSES = ["ON_TIME", "LATE", "SHORT", "ABSENT", "NO_SCHEDULE", "OPEN", "ON_LEAVE", "NONE"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

// Minutes an arrival may trail the scheduled start before it counts as LATE (clock rounding + a
// short grace). Tunable; the schedule variance is advisory, not a hard gate.
export const LATE_GRACE_MINUTES = 5;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// A manager/HR correction: append a single punch for `employeeId` (e.g. an OUT to close a forgotten
// clock-out, or a missed IN). Corrections are append-only — we never mutate an existing punch row —
// so the ledger stays a faithful, ordered history. Editing a wrong punch time is out of M4 scope.
export const clockCorrectionSchema = z.object({
  employeeId: z.string().min(1),
  type: z.enum(CLOCK_EVENT_TYPES),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date."),
  time: z.string().regex(HHMM, "Use a HH:MM time."),
  note: z.string().trim().max(300).optional(),
});
export type ClockCorrectionInput = z.infer<typeof clockCorrectionSchema>;

type PunchInput = { type: string; at: Date | string | number };
export type ClockSession = { inAt: Date; outAt: Date | null };

// Pair a set of raw punches into IN→OUT sessions. Robust to noise: a duplicate IN while already
// clocked in is ignored (the earliest IN wins); an OUT with no open IN is ignored. A trailing IN
// with no OUT yields an OPEN session (the "forgot to clock out" case). Worked hours count only
// CLOSED sessions — an open session contributes 0 until it's closed.
export function pairPunches(punches: PunchInput[]): {
  sessions: ClockSession[];
  workedHours: number;
  firstIn: Date | null;
  lastOut: Date | null;
  open: boolean;
} {
  const sorted = [...punches]
    .map((p) => ({ type: p.type, at: new Date(p.at) }))
    .filter((p) => !Number.isNaN(p.at.getTime()))
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  const sessions: ClockSession[] = [];
  let openIn: Date | null = null;
  for (const p of sorted) {
    if (p.type === "IN") {
      if (openIn === null) openIn = p.at; // ignore a duplicate IN — keep the earliest
    } else if (p.type === "OUT") {
      if (openIn !== null) {
        sessions.push({ inAt: openIn, outAt: p.at });
        openIn = null;
      }
    }
  }
  const open = openIn !== null;
  if (open) sessions.push({ inAt: openIn as Date, outAt: null });

  const workedHours =
    Math.round(sessions.reduce((sum, s) => sum + (s.outAt ? hoursBetween(s.inAt, s.outAt) : 0), 0) * 100) / 100;
  const firstIn = sessions.length ? sessions[0].inAt : null;
  const closed = sessions.filter((s) => s.outAt);
  const lastOut = closed.length ? closed[closed.length - 1].outAt : null;

  return { sessions, workedHours, firstIn, lastOut, open };
}

export type ScheduledShift = { startAt: Date | string | number; endAt: Date | string | number };

// A day's attendance verdict: pair the punches, then compare to the scheduled shift (if any).
//   OPEN        — still clocked in (an IN with no OUT).
//   ABSENT      — a shift was scheduled but no punches exist.
//   LATE        — first clock-in is more than the grace past the scheduled start.
//   SHORT       — worked fewer hours than the shift's scheduled length.
//   NO_SCHEDULE — punched, but there was no published shift to compare against.
//   ON_TIME     — punched, on time, and worked the scheduled hours.
//   NONE        — nothing to report (no punches, no shift).
// LATE takes precedence over SHORT (an arrival problem is the headline). `lateMinutes` / `shortHours`
// are always populated when a shift exists so the UI can show the detail regardless of the verdict.
export function computeAttendanceDay(punches: PunchInput[], shift?: ScheduledShift | null) {
  const { sessions, workedHours, firstIn, lastOut, open } = pairPunches(punches);
  const hasShift = Boolean(shift);
  const scheduledHours = hasShift ? hoursBetween(shift!.startAt, shift!.endAt) : 0;

  let lateMinutes = 0;
  let shortHours = 0;
  if (hasShift && firstIn) {
    lateMinutes = Math.max(0, Math.round((firstIn.getTime() - new Date(shift!.startAt).getTime()) / 60000));
  }
  if (hasShift && !open) {
    shortHours = Math.max(0, Math.round((scheduledHours - workedHours) * 100) / 100);
  }

  let status: AttendanceStatus;
  if (sessions.length === 0) {
    status = hasShift ? "ABSENT" : "NONE";
  } else if (open) {
    status = "OPEN";
  } else if (!hasShift) {
    status = "NO_SCHEDULE";
  } else if (lateMinutes > LATE_GRACE_MINUTES) {
    status = "LATE";
  } else if (shortHours > 0) {
    status = "SHORT";
  } else {
    status = "ON_TIME";
  }

  return { sessions, workedHours, scheduledHours, firstIn, lastOut, open, status, lateMinutes, shortHours };
}
