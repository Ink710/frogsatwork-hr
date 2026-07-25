import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getViewer } from "@hris/auth";
import { formatHours } from "@hris/workable-hours";
import { getTeamAttendance } from "@/lib/queries";
import { getT, getLocale } from "@/lib/i18n.server";
import { INTL_LOCALE } from "@/lib/i18n";
import { formatDate } from "@/lib/format";
import { AttendanceStatusBadge } from "@/components/attendance-ui";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("attendance.team.title")} · FrogsAtWorkHR` };
}

export default async function TeamAttendancePage({ searchParams }) {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const params = await searchParams;
  const [team, t, localeCode] = await Promise.all([getTeamAttendance(params?.date ?? null), getT(), getLocale()]);
  if (!team) notFound(); // non-approver
  const locale = INTL_LOCALE[localeCode];

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t("attendance.team.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("attendance.team.subtitle")}</p>
      </header>

      {/* Day navigation. */}
      <div className="mb-4 flex items-center justify-between gap-4">
        <Link
          href={`/attendance/team?date=${team.prevDay}`}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
        >
          <ChevronLeft className="h-4 w-4" /> {t("attendance.team.prevDay")}
        </Link>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {formatDate(team.date, locale)}
        </h2>
        <Link
          href={`/attendance/team?date=${team.nextDay}`}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
        >
          {t("attendance.team.nextDay")} <ChevronRight className="h-4 w-4" />
        </Link>
      </div>

      {team.rows.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
          {t("attendance.team.empty")}
        </p>
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
