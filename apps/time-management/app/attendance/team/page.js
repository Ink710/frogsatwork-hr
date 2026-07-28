import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getViewer } from "@hris/auth";
import { formatHours } from "@hris/workable-hours";
import { getTeamAttendance, getTeamAttendanceWeek } from "@/lib/queries";
import { getT, getLocale } from "@/lib/i18n.server";
import { INTL_LOCALE } from "@/lib/i18n";
import { formatDate } from "@/lib/format";
import { AttendanceStatusBadge } from "@/components/attendance-ui";
import { AttendanceRoster } from "@/components/AttendanceRoster";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("attendance.team.title")} · FrogsAtWorkHR` };
}

// Day / Week zoom toggle. Two links that switch `view` while keeping the page's date/week param out
// of the way (each view owns its own axis param).
function ViewToggle({ view, t }) {
  const tab = "rounded-md px-3 py-1.5 text-xs font-medium";
  const active = "bg-primary text-primary-foreground";
  const idle = "border border-border hover:bg-muted";
  return (
    <div className="inline-flex gap-1">
      <Link href="/attendance/team?view=day" className={`${tab} ${view === "day" ? active : idle}`}>{t("attendance.team.day")}</Link>
      <Link href="/attendance/team?view=week" className={`${tab} ${view === "week" ? active : idle}`}>{t("attendance.team.week")}</Link>
    </div>
  );
}

export default async function TeamAttendancePage({ searchParams }) {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const params = await searchParams;
  const view = params?.view === "week" ? "week" : "day";
  const [t, localeCode] = await Promise.all([getT(), getLocale()]);
  const locale = INTL_LOCALE[localeCode];

  // ── Week view: the roster grid ──────────────────────────────────────────────────────────────
  if (view === "week") {
    const week = await getTeamAttendanceWeek(params?.week ?? null);
    if (!week) notFound(); // non-approver

    return (
      <main className="mx-auto w-full max-w-5xl px-6 py-10">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">{t("attendance.team.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("attendance.team.rosterSubtitle")}</p>
        </header>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <ViewToggle view="week" t={t} />
          <div className="flex items-center gap-3">
            <Link
              href={`/attendance/team?view=week&week=${week.prevWeek}`}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
            >
              <ChevronLeft className="h-4 w-4" /> {t("attendance.team.prevWeek")}
            </Link>
            <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {t("timesheets.weekOf", { start: formatDate(week.weekStart, locale), end: formatDate(week.weekEnd, locale) })}
            </span>
            <Link
              href={`/attendance/team?view=week&week=${week.nextWeek}`}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
            >
              {t("attendance.team.nextWeek")} <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        </div>

        <AttendanceRoster week={week} t={t} />
      </main>
    );
  }

  // ── Day view: the single-day list (the original M4 view) ────────────────────────────────────
  const team = await getTeamAttendance(params?.date ?? null);
  if (!team) notFound(); // non-approver

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("attendance.team.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("attendance.team.subtitle")}</p>
      </header>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <ViewToggle view="day" t={t} />
        <div className="flex items-center gap-3">
          <Link
            href={`/attendance/team?date=${team.prevDay}`}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
          >
            <ChevronLeft className="h-4 w-4" /> {t("attendance.team.prevDay")}
          </Link>
          <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{formatDate(team.date, locale)}</span>
          <Link
            href={`/attendance/team?date=${team.nextDay}`}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
          >
            {t("attendance.team.nextDay")} <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {team.rows.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-4 py-6 text-sm text-muted-foreground">{t("attendance.team.empty")}</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {team.rows.map((r) => (
            <li key={r.employeeId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="text-sm font-medium">{r.name}</p>
                <p className="text-xs text-muted-foreground">
                  {r.firstIn ? (
                    <>
                      <span className="font-mono">{r.firstIn}–{r.lastOut ?? "…"}</span> ·{" "}
                      <span className="font-mono tabular-nums">{formatHours(r.workedHours)}</span>
                    </>
                  ) : (
                    t("attendance.noPunches")
                  )}
                  {r.scheduled ? <> · {t("attendance.scheduledShort")} <span className="font-mono">{r.scheduled.start}–{r.scheduled.end}</span></> : null}
                  {r.status === "LATE" ? <> · <span className="text-warning">{t("attendance.team.late", { minutes: String(r.lateMinutes) })}</span></> : null}
                  {r.status === "SHORT" ? <> · <span className="text-warning">{t("attendance.team.short", { hours: formatHours(r.shortHours) })}</span></> : null}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <AttendanceStatusBadge status={r.status} label={t(`enum.attendanceStatus.${r.status}`)} />
                <Link
                  href={`/attendance/correct?employeeId=${r.employeeId}&date=${team.date}`}
                  className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted"
                >
                  {t("attendance.team.correct")}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
