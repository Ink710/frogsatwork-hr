import { notFound } from "next/navigation";
import { getViewer } from "@hris/auth";
import { formatHours } from "@hris/workable-hours";
import { getPendingApprovals, isApprover } from "@/lib/queries";
import { getT, getLocale } from "@/lib/i18n.server";
import { INTL_LOCALE } from "@/lib/i18n";
import { formatDate, initials } from "@/lib/format";
import { Avatar } from "@/components/profile-ui";
import { ApprovalActions } from "@/components/ApprovalActions";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("approvals.title")} · FrogsAtWorkHR` };
}

export default async function ApprovalsPage() {
  const viewer = await getViewer();
  // Only managers + HR have an approvals queue; everyone else gets the branded 404.
  if (!viewer || !isApprover(viewer)) notFound();

  const [pending, t, localeCode] = await Promise.all([getPendingApprovals(), getT(), getLocale()]);
  const locale = INTL_LOCALE[localeCode];

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t("approvals.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("approvals.subtitle")}</p>
      </header>

      {pending.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("approvals.empty")}</p>
      ) : (
        <ul className="space-y-4">
          {pending.map((r) => (
            <li key={r.id} className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <Avatar initials={initials(r.employee.firstName, r.employee.lastName)} className="h-11 w-11 text-sm" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {r.employee.firstName} {r.employee.lastName}{" "}
                    <span className="text-muted-foreground">({r.employee.employeeNumber})</span>
                  </p>
                  <p className="text-sm">
                    {t(`enum.leaveType.${r.type}`)} · <span className="tabular-nums">{formatHours(r.hours)}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(r.startDate, locale)} – {formatDate(r.endDate, locale)}
                    {r.reason ? ` · ${r.reason}` : ""}
                  </p>
                  {r.overdraw && (
                    <p className="mt-1 text-xs text-warning">
                      {t("approvals.overdraw", { available: formatHours(r.available) })}
                    </p>
                  )}
                </div>
              </div>
              <ApprovalActions requestId={r.id} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
