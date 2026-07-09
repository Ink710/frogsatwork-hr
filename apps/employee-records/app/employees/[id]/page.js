import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewer, canEditEmployee, canTerminate } from "@hris/auth";
import { getEmployeeOverview } from "@/lib/queries";
import { getT, getLocale } from "@/lib/i18n.server";
import { INTL_LOCALE } from "@/lib/i18n";
import { formatDate, formatMoney, formatPayBasis } from "@/lib/format";
import { Card, Field, FieldGrid, Pill } from "@/components/profile-ui";
import { EmergencyContacts } from "@/components/EmergencyContacts";
import { ResendInviteButton } from "@/components/ResendInviteButton";

const actionBtn =
  "rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

export default async function EmployeeOverviewPage({ params }) {
  const { id } = await params;
  const e = await getEmployeeOverview(id);
  if (!e) notFound();

  const [viewer, t, localeCode] = await Promise.all([getViewer(), getT(), getLocale()]);
  const locale = INTL_LOCALE[localeCode];
  const te = (kind, val) => (val ? t(`enum.${kind}.${val}`) : "—");

  const canEdit = viewer ? canEditEmployee(viewer) : false;
  const canLifecycle = viewer ? canTerminate(viewer) : false;
  const isTerminated = e.employmentStatus === "TERMINATED";
  const isActive = e.employmentStatus === "ACTIVE";
  const onLeaveOrSuspended =
    e.employmentStatus === "ON_LEAVE" || e.employmentStatus === "SUSPENDED";
  const canManageContacts = canEdit || viewer?.employeeId === e.id;

  const c = e.current;
  const salaryLabel =
    e.comp?.salary != null
      ? `${formatMoney(e.comp.salary, e.comp.currency, locale)}${formatPayBasis(e.comp.payBasis)}`
      : null;

  return (
    <div className="space-y-6">
      {/* Actions */}
      {(canEdit || canLifecycle) && !isTerminated && (
        <div className="flex flex-wrap justify-end gap-2">
          {canEdit && (
            <>
              <Link href={`/employees/${e.id}/edit`} className={actionBtn}>{t("profile.recordChange")}</Link>
              <Link href={`/employees/${e.id}/correct`} className={actionBtn}>{t("profile.correctData")}</Link>
            </>
          )}
          {canLifecycle && isActive && (
            <>
              <Link href={`/employees/${e.id}/status?type=LEAVE`} className={actionBtn}>{t("profile.placeOnLeave")}</Link>
              <Link href={`/employees/${e.id}/status?type=SUSPENSION`} className={actionBtn}>{t("profile.suspend")}</Link>
            </>
          )}
          {canLifecycle && onLeaveOrSuspended && (
            <Link href={`/employees/${e.id}/reinstate`} className={actionBtn}>{t("profile.returnActive")}</Link>
          )}
          {canLifecycle && (
            <Link
              href={`/employees/${e.id}/terminate`}
              className="rounded-md border border-red-300 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/30"
            >
              {t("profile.terminate")}
            </Link>
          )}
        </div>
      )}
      {canLifecycle && isTerminated && e.eligibleForRehire && (
        <div className="flex justify-end">
          <Link
            href={`/employees/${e.id}/rehire`}
            className="rounded-md border border-green-300 px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-50 dark:border-green-900/60 dark:text-green-400 dark:hover:bg-green-950/30"
          >
            {t("profile.rehire")}
          </Link>
        </div>
      )}

      {/* Account activation */}
      {canEdit && !isTerminated && e.user && !e.user.emailVerifiedAt && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-900/50 dark:bg-amber-950/20">
          <div>
            <span className="font-medium text-amber-800 dark:text-amber-300">{t("profile.invitePending")}</span>
            <span className="ml-2 text-amber-700 dark:text-amber-400">
              {e.user.invitedAt ? t("profile.inviteNotSet") : t("profile.inviteNotSent")}
            </span>
          </div>
          <ResendInviteButton userId={e.userId} label={e.user.invitedAt ? t("profile.resendInvite") : t("profile.sendInvite")} />
        </div>
      )}

      {/* Current leave/suspension notice */}
      {e.currentStatusChange && (
        <div
          className={`rounded-md border p-4 text-sm ${
            e.currentStatusChange.type === "SUSPENSION"
              ? "border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/20"
              : "border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20"
          }`}
        >
          <span className="font-medium">
            {e.currentStatusChange.type === "SUSPENSION" ? t("profile.suspended") : t("profile.onLeave")}
          </span>
          {" "}
          {t("profile.since")}{" "}
          {formatDate(e.currentStatusChange.startDate, locale)}
          {e.currentStatusChange.expectedEnd && (
            <> · {t("profile.expectedReturn", { date: formatDate(e.currentStatusChange.expectedEnd, locale) })}</>
          )}
          {e.currentStatusChange.reason && <> — {e.currentStatusChange.reason}</>}
          {e.currentStatusChange.createdBy && (
            <span className="ml-2 text-zinc-500">{t("common.by", { name: e.currentStatusChange.createdBy.name })}</span>
          )}
        </div>
      )}

      {isTerminated && (
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900/50">
          <span className="font-medium">{t("profile.terminated")}</span>
          {e.terminationDate && <> {t("profile.terminatedOn", { date: formatDate(e.terminationDate, locale) })}</>}
          {e.terminationReason && <> — {e.terminationReason}</>}
          <span className="ml-2 text-zinc-500">
            ({e.eligibleForRehire ? t("profile.eligibleRehire") : t("profile.notEligibleRehire")})
          </span>
        </div>
      )}

      {/* Employment details */}
      <Card title={t("profile.employmentDetails")}>
        <FieldGrid>
          <Field label={t("profile.jobTitle")}>{c?.jobTitle}</Field>
          <Field label={t("profile.employmentType")}>{te("employmentType", c?.employmentType)}</Field>
          <Field label={t("profile.flsa")}>{te("flsa", c?.flsaClassification)}</Field>
          <Field label={t("profile.payFrequency")}>{te("payFrequency", c?.payFrequency)}</Field>
          <Field label={t("profile.workSchedule")}>{e.workSchedule}</Field>
          <Field label={t("profile.timeZone")}>{e.timeZone}</Field>
        </FieldGrid>
      </Card>

      {/* Compensation */}
      <Card title={t("profile.compensation")} action={e.canViewComp ? <Pill>{t("profile.compBadge")}</Pill> : null}>
        {e.canViewComp ? (
          <FieldGrid>
            <Field label={t("profile.baseSalary")}>{salaryLabel}</Field>
            <Field label={t("profile.lastReview")}>{formatDate(e.comp.lastReviewDate, locale)}</Field>
            <Field label={t("profile.nextReview")}>{formatDate(e.comp.nextReviewDate, locale)}</Field>
            <Field label={t("profile.equity")}>{e.comp.equityNote}</Field>
          </FieldGrid>
        ) : (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("profile.compHidden")}</p>
        )}
      </Card>

      {/* Emergency contact */}
      <Card title={t("profile.emergencyContact")}>
        <EmergencyContacts contacts={e.emergencyContacts} employeeId={e.id} canManage={canManageContacts} embedded />
      </Card>

      {/* Direct reports */}
      {e.reports.length > 0 && (
        <Card title={t("profile.directReports", { count: e.reports.length })}>
          <ul className="flex flex-wrap gap-2">
            {e.reports.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/employees/${r.id}`}
                  className="rounded-full border border-zinc-200 px-3 py-1 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                >
                  {r.firstName} {r.lastName}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Leave & suspension history */}
      {e.statusHistory.length > 0 && (
        <Card title={t("profile.leaveHistory")}>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {e.statusHistory.map((s) => (
              <li key={s.id} className="py-2.5 text-sm first:pt-0 last:pb-0">
                <span className="font-medium">{s.type === "SUSPENSION" ? t("profile.suspended") : t("profile.onLeave")}</span>
                <span className="ml-2 text-zinc-500">
                  {formatDate(s.startDate, locale)} — {formatDate(s.endDate, locale)}
                </span>
                {s.reason && <div className="mt-0.5 text-zinc-600 dark:text-zinc-300">{s.reason}</div>}
                {s.createdBy && <span className="text-xs text-zinc-400">{t("common.by", { name: s.createdBy.name })}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
