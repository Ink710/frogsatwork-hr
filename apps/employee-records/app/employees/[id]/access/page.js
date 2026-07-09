import { notFound } from "next/navigation";
import { getEmployeeAccess } from "@/lib/queries";
import { getT, getLocale } from "@/lib/i18n.server";
import { INTL_LOCALE } from "@/lib/i18n";
import { formatDate } from "@/lib/format";
import { Card, Field, FieldGrid, Pill } from "@/components/profile-ui";

function CheckRow({ ok, children }) {
  return (
    <li className="flex items-center gap-2.5 text-sm">
      <span
        className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs ${
          ok
            ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
            : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500"
        }`}
        aria-hidden="true"
      >
        {ok ? "✓" : "✗"}
      </span>
      <span className={ok ? "" : "text-zinc-400 dark:text-zinc-500"}>{children}</span>
    </li>
  );
}

// Access & RBAC tab. Gated to HR or the subject (a manager viewing a report gets null → 404).
export default async function EmployeeAccessPage({ params }) {
  const { id } = await params;
  const data = await getEmployeeAccess(id);
  if (!data) notFound();

  const [t, localeCode] = await Promise.all([getT(), getLocale()]);
  const locale = INTL_LOCALE[localeCode];
  const { role, activation, capabilities } = data;

  let accountStatus;
  if (activation.emailVerifiedAt) {
    accountStatus = <span className="text-green-700 dark:text-green-400">{t("access.activated", { date: formatDate(activation.emailVerifiedAt, locale) })}</span>;
  } else if (activation.invitedAt) {
    accountStatus = <span className="text-amber-700 dark:text-amber-400">{t("access.invitePending", { date: formatDate(activation.invitedAt, locale) })}</span>;
  } else {
    accountStatus = <span className="text-zinc-500">{t("access.notInvited")}</span>;
  }

  return (
    <div className="space-y-6">
      <Card title={t("access.systemAccess")} action={<Pill>{t(`enum.role.${role}`)}</Pill>}>
        <FieldGrid>
          <Field label={t("access.loginEmail")}>{data.email}</Field>
          <Field label={t("access.accountStatus")}>{accountStatus}</Field>
          <Field label={t("access.recordVisibility")}>{t(`access.scope.${capabilities.recordScope}`)}</Field>
          <Field label={t("access.compVisibility")}>{t(`access.comp.${role}`)}</Field>
        </FieldGrid>
      </Card>

      <Card title={t("access.permissions")}>
        <ul className="space-y-3">
          <CheckRow ok={capabilities.editRecords}>{t("access.permEdit")}</CheckRow>
          <CheckRow ok={capabilities.editCompensation}>{t("access.permComp")}</CheckRow>
          <CheckRow ok={capabilities.terminate}>{t("access.permTerminate")}</CheckRow>
          <CheckRow ok={capabilities.manageDepartments}>{t("access.permDepartments")}</CheckRow>
          <CheckRow ok={capabilities.manageSettings}>{t("access.permSettings")}</CheckRow>
        </ul>
        <p className="mt-5 text-xs text-zinc-400 dark:text-zinc-500">{t("access.footnote")}</p>
      </Card>
    </div>
  );
}
