import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, Users } from "lucide-react";
import { getViewer } from "@hris/auth";
import { formatHours } from "@hris/workable-hours";
import { getTeamTimesheets } from "@/lib/queries";
import { getT, getLocale } from "@/lib/i18n.server";
import { INTL_LOCALE } from "@/lib/i18n";
import { formatDate } from "@/lib/format";
import { TimesheetStatusBadge } from "@/components/timesheet-ui";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("myTeam.title")} · FrogsAtWorkHR` };
}

export default async function MyTeamPage({ searchParams }) {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const params = await searchParams;
  const [team, t, localeCode] = await Promise.all([getTeamTimesheets(params?.week ?? null), getT(), getLocale()]);
  if (!team) notFound(); // non-approver
  const locale = INTL_LOCALE[localeCode];

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <header className="mb-8">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Users className="h-6 w-6" aria-hidden="true" /> {t("myTeam.title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("myTeam.subtitle")}</p>
      </header>

      {/* Week navigation. */}
      <div className="mb-4 flex items-center justify-between gap-4">
        <Link
          href={`/my-team?week=${team.prevWeek}`}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
        >
          <ChevronLeft className="h-4 w-4" /> {t("myTeam.prevWeek")}
        </Link>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t("timesheets.weekOf", { start: formatDate(team.weekStart, locale), end: formatDate(team.weekEnd, locale) })}
        </h2>
        <Link
          href={`/my-team?week=${team.nextWeek}`}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
        >
          {t("myTeam.nextWeek")} <ChevronRight className="h-4 w-4" />
        </Link>
      </div>

      {team.rows.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-4 py-6 text-sm text-muted-foreground">{t("myTeam.empty")}</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {team.rows.map((r) => (
            <li key={r.employeeId}>
              <Link
                href={`/my-team/${r.employeeId}?week=${team.weekStart}`}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-muted"
              >
                <div>
                  <p className="text-sm font-medium">
                    {r.name} <span className="font-mono text-xs text-muted-foreground">({r.employeeNumber})</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("timesheets.totalLabel")}: <span className="font-mono tabular-nums">{formatHours(r.total)}</span>
                    {r.overtime > 0 ? <> · <span className="text-warning">{t("timesheets.otLabel")} <span className="font-mono tabular-nums">{formatHours(r.overtime)}</span></span></> : null}
                    {r.doubletime > 0 ? <> · <span className="text-destructive">{t("timesheets.dtLabel")} <span className="font-mono tabular-nums">{formatHours(r.doubletime)}</span></span></> : null}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {r.status ? (
                    <TimesheetStatusBadge status={r.status} label={t(`timesheets.status.${r.status}`)} />
                  ) : (
                    <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">{t("myTeam.notStarted")}</span>
                  )}
                  <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
