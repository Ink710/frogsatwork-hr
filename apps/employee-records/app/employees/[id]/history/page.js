import { notFound } from "next/navigation";
import { getEmployeeHistory } from "@/lib/queries";
import { HistoryTimeline } from "@/components/HistoryTimeline";
import { Card, Pill } from "@/components/profile-ui";

// The signature feature: the effective-dated timeline. Salary is comp-gated inside the query.
export default async function EmployeeHistoryPage({ params }) {
  const { id } = await params;
  const data = await getEmployeeHistory(id);
  if (!data) notFound();

  return (
    <Card
      title="History"
      action={!data.canViewComp ? <Pill>Compensation hidden</Pill> : null}
    >
      <HistoryTimeline history={data.history} />
    </Card>
  );
}
