import { notFound } from "next/navigation";
import { getViewer } from "@hris/auth";
import { formatHours } from "@hris/workable-hours";
import { getLeavePolicies } from "@/lib/queries";
import { getT } from "@/lib/i18n.server";
import { Card } from "@/components/profile-ui";
import { RunAccrualButton } from "@/components/RunAccrualButton";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("policies.title")} · FrogsAtWorkHR` };
}

export default async function PoliciesPage() {
  const viewer = await getViewer();
  const policies = await getLeavePolicies();
  // getLeavePolicies returns null for non-HR → branded 404.
  if (!viewer || policies == null) notFound();
  const t = await getT();
  const isAdmin = viewer.role === "HR_ADMIN";

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{t("policies.title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("policies.subtitle")}</p>

      <Card title={t("policies.accrualHeading")} className="mt-6">
        <table className="w-full font-table text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="pb-2 font-medium">{t("policies.colType")}</th>
              <th className="pb-2 text-right font-medium">{t("policies.colAccrual")}</th>
              <th className="pb-2 text-right font-medium">{t("policies.colCap")}</th>
            </tr>
          </thead>
          <tbody>
            {policies.map((p) => (
              <tr key={p.id} className="border-b border-border/60 last:border-0">
                <td className="py-2.5">{t(`enum.leaveType.${p.type}`)}</td>
                <td className="py-2.5 text-right font-mono tabular-nums">
                  {p.accrues ? formatHours(p.accrualHoursPerMonth) : <span className="text-muted-foreground">{t("policies.noAccrual")}</span>}
                </td>
                <td className="py-2.5 text-right font-mono tabular-nums">
                  {p.maxBalanceHours != null ? formatHours(p.maxBalanceHours) : <span className="text-muted-foreground">{t("policies.uncapped")}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {isAdmin && (
        <Card title={t("policies.runHeading")} className="mt-6">
          <p className="mb-4 text-sm text-muted-foreground">{t("policies.runHelp")}</p>
          <RunAccrualButton />
        </Card>
      )}
    </main>
  );
}
