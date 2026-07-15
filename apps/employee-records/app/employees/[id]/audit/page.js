import { notFound } from "next/navigation";
import { getEmployeeAuditLog } from "@/lib/queries";
import { getT } from "@/lib/i18n.server";
import { AuditLogList } from "@/components/AuditLogList";
import { Card, Pill } from "@/components/profile-ui";

export default async function EmployeeAuditPage({ params }) {
  const { id } = await params;
  const data = await getEmployeeAuditLog(id);

  // RLS hid the employee (or no session) → same 404 boundary as the profile.
  if (!data) notFound();

  const t = await getT();

  return (
    <Card title={t("audit.title")} action={!data.canViewComp ? <Pill>{t("history.compHidden")}</Pill> : null}>
      {data.events.length === 0 ? (
        <p className="text-sm text-muted-foreground dark:text-muted-foreground">{t("audit.none")}</p>
      ) : (
        <AuditLogList employeeId={data.employee.id} initialEvents={data.events} initialCursor={data.nextCursor} />
      )}
    </Card>
  );
}
