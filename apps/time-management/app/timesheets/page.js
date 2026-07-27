import { redirect } from "next/navigation";
import { getViewer } from "@hris/auth";
import { formatHours } from "@hris/workable-hours";
import { getCurrentTimesheet, getMyTimesheets, getMyProjects, getMyMeetings, getWeekMeetings } from "@/lib/queries";
import { getT, getLocale } from "@/lib/i18n.server";
import { INTL_LOCALE } from "@/lib/i18n";
import { formatDate } from "@/lib/format";
import { TimesheetGrid } from "@/components/TimesheetGrid";
import { TimesheetStatusBadge } from "@/components/timesheet-ui";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("timesheets.title")} · FrogsAtWorkHR` };
}

export default async function TimesheetsPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const [current, history, projects, meetings, suggestions, t, localeCode] = await Promise.all([
    getCurrentTimesheet(),
    getMyTimesheets(),
    getMyProjects(),
    getMyMeetings(),
    getWeekMeetings(),
    getT(),
    getLocale(),
  ]);
  const locale = INTL_LOCALE[localeCode];

  if (!current) {
    return (
      <main className="mx-auto w-full max-w-4xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">{t("timesheets.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("timesheets.noRecord")}</p>
      </main>
    );
  }

  // The current week is shown in the editable grid; keep it out of the history list below.
  const past = history.filter((ts) => new Date(ts.periodStart).toISOString().slice(0, 10) !== current.weekStart);

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t("timesheets.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("timesheets.subtitle")}</p>
      </header>

      <section>
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t("timesheets.weekOf", { start: formatDate(current.weekStart, locale), end: formatDate(current.weekEnd, locale) })}
          </h2>
          <TimesheetStatusBadge status={current.status} label={t(`timesheets.status.${current.status}`)} />
        </div>
        {current.status === "REJECTED" && current.decisionNote && (
          <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {t("timesheets.rejectedNote", { note: current.decisionNote })}
          </p>
        )}
        <TimesheetGrid
          week={{ start: current.weekStart, end: current.weekEnd }}
          initialEntries={current.entries}
          flsa={current.flsa}
          editable={current.editable}
          projects={projects}
          meetings={meetings}
          suggestions={suggestions}
        />
      </section>

      <section className="mt-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("timesheets.history")}</h2>
        {past.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("timesheets.noHistory")}</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {past.map((ts) => (
              <li key={ts.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">
                    {formatDate(ts.periodStart, locale)} – {formatDate(ts.periodEnd, locale)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("timesheets.totalLabel")}: <span className="font-mono tabular-nums">{formatHours(ts.total)}</span>
                    {ts.overtime > 0 ? <> · <span className="text-warning">{t("timesheets.otLabel")}: <span className="font-mono tabular-nums">{formatHours(ts.overtime)}</span></span></> : null}
                    {ts.doubletime > 0 ? <> · <span className="text-destructive">{t("timesheets.dtLabel")}: <span className="font-mono tabular-nums">{formatHours(ts.doubletime)}</span></span></> : null}
                  </p>
                </div>
                <TimesheetStatusBadge status={ts.status} label={t(`timesheets.status.${ts.status}`)} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
