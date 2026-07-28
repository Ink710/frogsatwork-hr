import Link from "next/link";
import { formatHours } from "@hris/workable-hours";

// Server component (no interactivity beyond correction links). Renders the weekly attendance roster:
// reports down the rows, the 7 weekdays across the top, each cell the derived daily status. Today's
// column is highlighted; weekends are shaded; exception cells (LATE/SHORT/ABSENT/OPEN) link to the
// correction form. A day covered by approved leave arrives as ON_LEAVE (see getTeamAttendanceWeek).
// Its own status→style map (not the client badge's) so it can style cells during server render.
const CELL_STYLES = {
  ON_TIME: "bg-success/10 text-success",
  LATE: "bg-warning/10 text-warning",
  SHORT: "bg-warning/10 text-warning",
  ABSENT: "bg-destructive/10 text-destructive",
  OPEN: "bg-info/10 text-info",
  ON_LEAVE: "bg-primary/10 text-primary",
  NO_SCHEDULE: "bg-muted text-muted-foreground",
  NONE: "",
};
const EXCEPTION = new Set(["LATE", "SHORT", "ABSENT", "OPEN"]);

// A worked day shows its hours; a 0-hour verdict (Absent / Open / On leave) shows the status label.
function cellContent(cell, t) {
  if (cell.status === "NONE") return null;
  if (cell.workedHours > 0) return formatHours(cell.workedHours);
  return t(`enum.attendanceStatus.${cell.status}`);
}

const isWeekend = (date) => {
  const dow = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return dow === 0 || dow === 6;
};
const dowOf = (date) => new Date(`${date}T00:00:00.000Z`).getUTCDay();

export function AttendanceRoster({ week, t }) {
  if (week.rows.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
        {t("attendance.roster.empty")}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 text-left font-medium">{t("attendance.roster.person")}</th>
            {week.days.map((d) => {
              const today = d === week.today;
              return (
                <th
                  key={d}
                  className={`px-2 py-2 text-center font-medium ${isWeekend(d) ? "bg-muted/30" : ""} ${today ? "bg-primary/10 text-primary" : ""}`}
                >
                  <div>{t(`enum.dayOfWeekShort.${dowOf(d)}`)}</div>
                  <div className="font-mono tabular-nums text-[11px] opacity-80">{d.slice(8)}</div>
                </th>
              );
            })}
            <th className="px-3 py-2 text-right font-medium">{t("attendance.roster.total")}</th>
          </tr>
        </thead>
        <tbody>
          {week.rows.map((r) => (
            <tr key={r.employeeId} className="border-b border-border/60 last:border-0">
              <td className="whitespace-nowrap px-3 py-2 font-medium">{r.name}</td>
              {r.cells.map((c) => {
                const today = c.date === week.today;
                const content = cellContent(c, t);
                const pill = (
                  <span
                    className={`inline-block rounded-md px-1.5 py-0.5 text-xs font-medium ${CELL_STYLES[c.status] ?? ""}`}
                    title={t(`enum.attendanceStatus.${c.status}`)}
                  >
                    {content}
                  </span>
                );
                return (
                  <td
                    key={c.date}
                    className={`px-2 py-2 text-center ${isWeekend(c.date) ? "bg-muted/20" : ""} ${today ? "bg-primary/5" : ""}`}
                  >
                    {content == null ? (
                      <span className="text-muted-foreground">·</span>
                    ) : EXCEPTION.has(c.status) ? (
                      <Link href={`/attendance/correct?employeeId=${r.employeeId}&date=${c.date}`} className="hover:opacity-80">
                        {pill}
                      </Link>
                    ) : (
                      pill
                    )}
                  </td>
                );
              })}
              <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">{formatHours(r.totalWorked)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
