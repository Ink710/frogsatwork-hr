"use client";

import { useActionState } from "react";
import { useT } from "@/components/LocaleProvider";
import { clockIn, clockOut } from "@/app/attendance/actions";

// Derived per-day attendance verdict → a semantic pill (auto-themes light/dark). ON_TIME is good;
// LATE/SHORT are advisory warnings; ABSENT is a hard miss; OPEN = still clocked in.
const STATUS_STYLES = {
  ON_TIME: "bg-success/10 text-success",
  LATE: "bg-warning/10 text-warning",
  SHORT: "bg-warning/10 text-warning",
  ABSENT: "bg-destructive/10 text-destructive",
  OPEN: "bg-info/10 text-info",
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
