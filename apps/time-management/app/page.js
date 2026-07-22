import { redirect } from "next/navigation";
import { Clock, ClipboardList, CalendarDays, CalendarClock, Inbox, AlertTriangle, Users } from "lucide-react";
import { getViewer, auth } from "@hris/auth";
import { formatHours } from "@hris/workable-hours";
import { getMyTimeSnapshot, getTeamTimeSnapshot } from "@/lib/queries";
import { getT, getLocale } from "@/lib/i18n.server";
import { INTL_LOCALE } from "@/lib/i18n";
import { formatDate } from "@/lib/format";
import { StatCard, Section } from "@/components/dashboard-ui";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("home.title")} · FrogsAtWorkHR` };
}

export default async function HomePage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const [me, team, session, t, localeCode] = await Promise.all([
    getMyTimeSnapshot(),
    getTeamTimeSnapshot(),
    auth(),
    getT(),
    getLocale(),
  ]);
  const locale = INTL_LOCALE[localeCode];
  const name = session?.user?.name ?? "";

  // Accounts with no employee record (e.g. a bare HR/SYSTEM login) get a minimal shell.
  if (!me) {
    return (
      <main className="mx-auto w-full max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">{t("home.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("dash.noRecord")}</p>
      </main>
    );
  }

  const clock = me.clock;
  const ts = me.timesheet;

  // Oversight exception hint — only the non-zero parts.
  const exc = team?.todayExceptions;
  const excTotal = exc ? exc.late + exc.absent + exc.short + exc.open : 0;
  const excParts = exc
    ? [
        exc.late && t("dash.excLate", { n: String(exc.late) }),
        exc.absent && t("dash.excAbsent", { n: String(exc.absent) }),
        exc.short && t("dash.excShort", { n: String(exc.short) }),
        exc.open && t("dash.excOpen", { n: String(exc.open) }),
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t("home.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {name ? t("home.greeting", { name }) : t("dash.subtitle")}
        </p>
      </header>

      {/* Personal snapshot — every role. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t("dash.clockStatus")}
          value={clock?.clockedIn ? t("dash.clockedIn") : t("dash.clockedOut")}
          hint={
            clock?.clockedIn
              ? t("attendance.clockedInSince", { time: clock.since })
              : `${t("attendance.workedToday")}: ${formatHours(clock?.workedHours ?? 0)}`
          }
          href="/attendance"
          icon={Clock}
        />
        <StatCard
          label={t("dash.thisWeek")}
          value={t(`timesheets.status.${ts?.status ?? "DRAFT"}`)}
          hint={
            ts
              ? `${formatHours(ts.total)}${ts.overtime > 0 ? ` · ${t("timesheets.otLabel")} ${formatHours(ts.overtime)}` : ""}`
              : undefined
          }
          href="/timesheets"
          icon={ClipboardList}
        />
        <StatCard
          label={t("dash.ptoAvailable")}
          value={formatHours(me.ptoAvailable)}
          hint={me.pendingRequests > 0 ? t("dash.ptoPending", { count: String(me.pendingRequests) }) : undefined}
          href="/time-off"
          icon={CalendarDays}
        />
        <StatCard
          label={t("dash.nextShift")}
          value={me.nextShift ? formatDate(me.nextShift.date, locale) : t("dash.noShift")}
          hint={
            me.nextShift
              ? `${me.nextShift.start}–${me.nextShift.end}${me.nextShift.role ? ` · ${me.nextShift.role}` : ""}`
              : undefined
          }
          href="/schedule"
          icon={CalendarClock}
        />
      </div>

      {/* Oversight — managers + HR only. */}
      {team && (
        <>
          <Section title={t("dash.oversight")} icon={Users}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <StatCard
                label={t("dash.pendingApprovals")}
                value={team.pendingApprovals.total}
                hint={t("dash.pendingBreakdown", {
                  leave: String(team.pendingApprovals.leave),
                  timesheets: String(team.pendingApprovals.timesheets),
                  swaps: String(team.pendingApprovals.swaps),
                })}
                href="/approvals"
                icon={Inbox}
              />
              <StatCard
                label={t("dash.todayExceptions")}
                value={excTotal}
                hint={excTotal > 0 ? excParts : t("dash.allClear")}
                href="/attendance/team"
                icon={AlertTriangle}
              />
              <StatCard
                label={t("dash.otFlags")}
                value={team.otFlags}
                hint={t("dash.otFlagsHint")}
                href="/approvals"
                icon={ClipboardList}
              />
            </div>
          </Section>

          <Section title={t("dash.whosOff")} icon={CalendarDays}>
            {team.whosOffToday.length === 0 ? (
              <p className="rounded-xl border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
                {t("dash.noOneOff")}
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                {team.whosOffToday.map((o) => (
                  <li key={o.employeeId} className="flex items-center justify-between gap-3 px-4 py-3">
                    <span className="text-sm font-medium">{o.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {t(`enum.leaveType.${o.type}`)} · {t("dash.through", { date: formatDate(o.endDate, locale) })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
    </main>
  );
}
