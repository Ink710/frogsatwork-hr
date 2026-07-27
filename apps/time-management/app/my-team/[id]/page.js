import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getViewer } from "@hris/auth";
import { getTeamMemberTimesheet } from "@/lib/queries";
import { getT, getLocale } from "@/lib/i18n.server";
import { INTL_LOCALE } from "@/lib/i18n";
import { formatDate } from "@/lib/format";
import { TimesheetGrid } from "@/components/TimesheetGrid";
import { TimesheetStatusBadge } from "@/components/timesheet-ui";
import { TimesheetApprovalActions } from "@/components/TimesheetApprovalActions";
import { adjustTimesheet } from "@/app/timesheets/actions";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("myTeam.title")} · FrogsAtWorkHR` };
}

export default async function MemberTimesheetPage({ params, searchParams }) {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const { id } = await params;
  const sp = await searchParams;
  const [data, t, localeCode] = await Promise.all([getTeamMemberTimesheet(id, sp?.week ?? null), getT(), getLocale()]);
  if (!data) notFound(); // not a report / not an approver
  const locale = INTL_LOCALE[localeCode];
  const { employee, timesheet, projects, meetings } = data;

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <Link
        href={`/my-team?week=${timesheet.weekStart}`}
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> {t("myTeam.back")}
      </Link>

      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("myTeam.forEmployee", { name: employee.name })}{" "}
            <span className="font-mono text-base text-muted-foreground">({employee.employeeNumber})</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("timesheets.weekOf", { start: formatDate(timesheet.weekStart, locale), end: formatDate(timesheet.weekEnd, locale) })}
          </p>
        </div>
        <TimesheetStatusBadge status={timesheet.status} label={t(`timesheets.status.${timesheet.status}`)} />
      </header>

      {timesheet.adjustable ? (
        <p className="mb-4 rounded-md bg-info/10 px-3 py-2 text-sm text-info">{t("myTeam.adjustHint")}</p>
      ) : (
        <p className="mb-4 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          {t("myTeam.notAdjustable", { status: t(`timesheets.status.${timesheet.status}`) })}
        </p>
      )}

      <TimesheetGrid
        week={{ start: timesheet.weekStart, end: timesheet.weekEnd }}
        initialEntries={timesheet.entries}
        flsa={timesheet.flsa}
        editable={timesheet.adjustable}
        projects={projects}
        meetings={meetings}
        mode="adjust"
        action={adjustTimesheet.bind(null, employee.id, timesheet.weekStart)}
      />

      {timesheet.status === "SUBMITTED" && (
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("myTeam.decision")}</h2>
          <div className="rounded-xl border border-border bg-card p-5">
            <TimesheetApprovalActions timesheetId={timesheet.id} />
          </div>
        </section>
      )}
    </main>
  );
}
