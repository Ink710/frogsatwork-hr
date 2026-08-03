"use client";

import { useActionState, useEffect, useState } from "react";
import { formatHours } from "@hris/workable-hours";
import { useT } from "@/components/LocaleProvider";
import { clockIn, clockOut } from "@/app/attendance/actions";

// The "worked today" figure. Starts at the server-computed value (so SSR + first paint match — no
// hydration flash) and, while clocked in, ticks up live from the open session's start (openSinceMs).
// `baseHours` = worked from CLOSED sessions; the open session's elapsed time is added on each tick.
export function WorkedToday({ initialLabel, baseHours = 0, openSinceMs = null }) {
  const [label, setLabel] = useState(initialLabel);
  useEffect(() => {
    if (openSinceMs == null) return; // clocked out → static
    const tick = () => setLabel(formatHours(baseHours + Math.max(0, (Date.now() - openSinceMs) / 3_600_000)));
    tick();
    const id = setInterval(tick, 30_000); // 30s — enough to catch each minute rollover promptly
    return () => clearInterval(id);
  }, [initialLabel, baseHours, openSinceMs]);
  return <span className="font-mono tabular-nums">{label}</span>;
}

// Derived per-day attendance verdict → a semantic pill (auto-themes light/dark). ON_TIME is good;
// LATE/SHORT are advisory warnings; ABSENT is a hard miss; OPEN = still clocked in.
const STATUS_STYLES = {
  ON_TIME: "bg-success/10 text-success",
  LATE: "bg-warning/10 text-warning",
  SHORT: "bg-warning/10 text-warning",
  ABSENT: "bg-destructive/10 text-destructive",
  OPEN: "bg-info/10 text-info",
  ON_LEAVE: "bg-primary/10 text-primary", // planned absence — a calm accent, not an exception color
  NO_SCHEDULE: "bg-muted text-muted-foreground",
  NONE: "bg-muted text-muted-foreground",
};

export function AttendanceStatusBadge({ status, label }) {
  return (
    <span className={`rounded-md px-2 py-1 text-xs font-medium ${STATUS_STYLES[status] ?? STATUS_STYLES.NONE}`}>
      {label ?? status}
    </span>
  );
}

// The big clock in / clock out control. One button whose action + styling flips on the current
// clocked-in state (the server passes it, and revalidatePath re-renders after each punch).
export function ClockButton({ clockedIn }) {
  const t = useT();
  const [state, formAction, pending] = useActionState(clockedIn ? clockOut : clockIn, undefined);

  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <button
        type="submit"
        disabled={pending}
        className={`rounded-lg px-6 py-3 text-base font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:opacity-60 ${
          clockedIn ? "bg-destructive" : "bg-primary"
        }`}
      >
        {pending ? t("attendance.working") : clockedIn ? t("attendance.clockOut") : t("attendance.clockIn")}
      </button>
      {state?.error && <p className="text-xs text-destructive">{state.error}</p>}
    </form>
  );
}
