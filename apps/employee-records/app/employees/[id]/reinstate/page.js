import Link from "next/link";
import { notFound } from "next/navigation";
import { getEmployeeForReinstate } from "@/lib/queries";
import { humanize, formatDate } from "@/lib/format";
import { ReinstateForm } from "@/components/ReinstateForm";

export const metadata = { title: "Return to active · PeopleBase" };

export default async function ReinstatePage({ params }) {
  const { id } = await params;
  const employee = await getEmployeeForReinstate(id);
  const status = employee?.employmentStatus;
  if (!employee || (status !== "ON_LEAVE" && status !== "SUSPENDED")) notFound();

  return (
    <main className="mx-auto w-full max-w-lg px-6 py-10">
      <Link href={`/employees/${id}`} className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
        ← Back to profile
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Return to active</h1>
      <p className="mt-1 text-sm text-zinc-500">
        {employee.firstName} {employee.lastName} is currently {humanize(status).toLowerCase()}
        {employee.current ? <> since {formatDate(employee.current.startDate)}</> : null}. This
        closes that record and sets them back to active.
      </p>
      <ReinstateForm employeeId={id} />
    </main>
  );
}
