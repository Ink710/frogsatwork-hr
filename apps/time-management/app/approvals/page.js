import { notFound } from "next/navigation";
import { getViewer } from "@hris/auth";
import { formatHours } from "@hris/workable-hours";
import { getPendingLeave, getPendingTimesheets, getPendingSwaps, isApprover } from "@/lib/queries";
import { getT, getLocale } from "@/lib/i18n.server";
import { INTL_LOCALE } from "@/lib/i18n";
import { formatDate, initials } from "@/lib/format";
import { Avatar } from "@/components/profile-ui";
import { ApprovalActions } from "@/components/ApprovalActions";
import { TimesheetApprovalActions } from "@/components/TimesheetApprovalActions";
import { ShiftSwapApprovalActions } from "@/components/ShiftSwapApprovalActions";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("approvals.title")} · FrogsAtWorkHR` };
}

// The unified inbox: pending leave requests + submitted timesheets the viewer may act on.
export default async function ApprovalsPage() {
  const viewer = await getViewer();
  if (!viewer || !isApprover(viewer)) notFound();

  const [leave, timesheets, swaps, t, localeCode] = await Promise.all([
    getPendingLeave(),
    getPendingTimesheets(),
    getPendingSwaps(),
    getT(),
    getLocale(),
  ]);
  const locale = INTL_LOCALE[localeCode];
  const empty = leave.length === 0 && timesheets.length === 0 && swaps.length === 0;

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t("approvals.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("approvals.subtitle")}</p>
      </header>

      {empty && <p className="text-sm text-muted-foreground">{t("approvals.empty")}</p>}

      {leave.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("approvals.leaveSection")}</h2>
          <ul className="space-y-4">
            {leave.map((r) => (
              <li key={r.id} className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <Avatar initials={initials(r.employee.firstName, r.employee.lastName)} className="h-11 w-11 text-sm" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {r.employee.firstName} {r.employee.lastName} <span className="font-mono text-muted-foreground">({r.employee.employeeNumber})</span>
                    </p>
                    <p className="text-sm">
                      {t(`enum.leaveType.${r.type}`)} · <span className="font-mono tabular-nums">{formatHours(r.hours)}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(r.startDate, locale)} – {formatDate(r.endDate, locale)}
                      {r.reason ? ` · ${r.reason}` : ""}
                    </p>
                    {r.overdraw && (
                      <p className="mt-1 text-xs text-warning">{t("approvals.overdraw", { available: formatHours(r.available) })}</p>
                    )}
                  </div>
                </div>
                <ApprovalActions requestId={r.id} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {timesheets.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("approvals.timesheetSection")}</h2>
          <ul className="space-y-4">
            {timesheets.map((ts) => (
              <li key={ts.id} className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <Avatar initials={initials(ts.employee.firstName, ts.employee.lastName)} className="h-11 w-11 text-sm" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {ts.employee.firstName} {ts.employee.lastName} <span className="font-mono text-muted-foreground">({ts.employee.employeeNumber})</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(ts.periodStart, locale)} – {formatDate(ts.periodEnd, locale)}
                    </p>
                    <p className="text-sm">
                      {t("timesheets.totalLabel")}: <span className="font-mono tabular-nums">{formatHours(ts.total)}</span>
                      {ts.overtime > 0 ? <> · <span className="text-warning">{t("timesheets.otLabel")}: {formatHours(ts.overtime)}</span></> : null}
                    </p>
                  </div>
                </div>
                <TimesheetApprovalActions timesheetId={ts.id} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {swaps.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("approvals.swapSection")}</h2>
          <ul className="space-y-4">
            {swaps.map((s) => (
              <li key={s.id} className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <Avatar initials={initials(s.requester.firstName, s.requester.lastName)} className="h-11 w-11 text-sm" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {s.requester.firstName} {s.requester.lastName} <span className="font-mono text-muted-foreground">({s.requester.employeeNumber})</span>
                    </p>
                    <p className="text-sm">
                      {s.targetName
                        ? t("approvals.swapTo", { name: s.targetName })
                        : t("approvals.swapDrop")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(s.shiftDate, locale)} · {s.startTime}–{s.endTime}
                      {s.reason ? ` · ${s.reason}` : ""}
                    </p>
                  </div>
                </div>
                <ShiftSwapApprovalActions swapId={s.id} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
