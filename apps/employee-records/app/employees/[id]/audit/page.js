import { notFound } from "next/navigation";
import { getEmployeeAuditLog } from "@/lib/queries";
import { AuditLogList } from "@/components/AuditLogList";
import { Card, Pill } from "@/components/profile-ui";

export default async function EmployeeAuditPage({ params }) {
  const { id } = await params;
  const data = await getEmployeeAuditLog(id);

  // RLS hid the employee (or no session) → same 404 boundary as the profile.
  if (!data) notFound();

  return (
    <Card
      title="Audit log"
      action={!data.canViewComp ? <Pill>Compensation hidden</Pill> : null}
    >
      {data.events.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No audit events recorded.</p>
      ) : (
        <AuditLogList
          employeeId={data.employee.id}
          initialEvents={data.events}
          initialCursor={data.nextCursor}
        />
      )}
    </Card>
  );
}
