import { notFound } from "next/navigation";
import { getEmployeeHistory } from "@/lib/queries";
import { getT, getLocale } from "@/lib/i18n.server";
import { INTL_LOCALE } from "@/lib/i18n";
import { HistoryTimeline } from "@/components/HistoryTimeline";
import { Card, Pill } from "@/components/profile-ui";

// The signature feature: the effective-dated timeline. Salary is comp-gated inside the query.
export default async function EmployeeHistoryPage({ params }) {
  const { id } = await params;
  const data = await getEmployeeHistory(id);
  if (!data) notFound();

  const [t, localeCode] = await Promise.all([getT(), getLocale()]);

  return (
    <Card title={t("history.title")} action={!data.canViewComp ? <Pill>{t("history.compHidden")}</Pill> : null}>
      <HistoryTimeline history={data.history} t={t} locale={INTL_LOCALE[localeCode]} />
    </Card>
  );
}
