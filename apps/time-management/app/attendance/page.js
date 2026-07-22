import { redirect } from "next/navigation";
import { getViewer } from "@hris/auth";
import { formatHours } from "@hris/workable-hours";
import { getClockStatus, getMyAttendance } from "@/lib/queries";
import { getT, getLocale } from "@/lib/i18n.server";
import { INTL_LOCALE } from "@/lib/i18n";
import { formatDate } from "@/lib/format";
import { AttendanceStatusBadge, ClockButton } from "@/components/attendance-ui";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("attendance.title")} · FrogsAtWorkHR` };
}

export default async function AttendancePage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const [status, mine, t, localeCode] = await Promise.all([
    getClockStatus(),
    getMyAttendance(),
    getT(),
    getLocale(),
  ]);
  const locale = INTL_LOCALE[localeCode];

  if (!status) {
    return (
      <main className="mx-auto w-full max-w-4xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">{t("attendance.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("attendance.noRecord")}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t("attendance.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("attendance.subtitle")}</p>
      </header>

      {/* Today: the clock control + a live status line. */}
      <section className="rounded-xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {t("attendance.today")}
            </p>
            <p className="mt-1 text-sm">
              {status.clockedIn ? (
                <span className="text-info">{t("attendance.clockedInSince", { time: status.since })}</span>
              ) : (
                <span className="text-muted-foreground">{t("attendance.notClockedIn")}</span>
              )}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("attendance.workedToday")}: <span className="tabular-nums">{formatHours(status.workedHours)}</span>
              {status.scheduled ? (
                <> · {t("attendance.scheduled")}: {status.scheduled.start}–{status.scheduled.end}</>
              ) : null}
            </p>
          </div>
          <ClockButton clockedIn={status.clockedIn} />
        </div>
      </section>

      {/* Recent days with the derived variance verdict. */}
      <section className="mt-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t("attendance.recent")}
        </h2>
        {mine.days.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("attendance.noHistory")}</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {mine.days.map((d) => (
              <li key={d.date} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{formatDate(d.date, locale)}</p>
                  <p className="text-xs text-muted-foreground">
                    {d.firstIn ? (
                      <>
                        {d.firstIn}–{d.lastOut ?? "…"} · <span className="tabular-nums">{formatHours(d.workedHours)}</span>
                      </>
                    ) : (
                      t("attendance.noPunches")
                    )}
                    {d.scheduled ? (
                      <> · {t("attendance.scheduledShort")} {d.scheduled.start}–{d.scheduled.end}</>
                    ) : null}
                  </p>
                </div>
                <AttendanceStatusBadge status={d.status} label={t(`enum.attendanceStatus.${d.status}`)} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
