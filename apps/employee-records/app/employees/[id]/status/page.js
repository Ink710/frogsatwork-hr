import Link from "next/link";
import { notFound } from "next/navigation";
import { getEmployeeForStatusChange } from "@/lib/queries";
import { StatusChangeForm } from "@/components/StatusChangeForm";

export const metadata = { title: "Change status · PeopleBase" };

export default async function StatusChangePage({ params, searchParams }) {
  const { id } = await params;
  const sp = await searchParams;
  // Only leave/suspension are handled here; anything else falls back to leave.
  const type = sp?.type === "SUSPENSION" ? "SUSPENSION" : "LEAVE";

  const employee = await getEmployeeForStatusChange(id);
  // Only an active employee can start a leave/suspension (one open span at a time).
  if (!employee || employee.employmentStatus !== "ACTIVE") notFound();

  const isSuspension = type === "SUSPENSION";

  return (
    <main className="mx-auto w-full max-w-lg px-6 py-10">
      <Link href={`/employees/${id}`} className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
        ← Back to profile
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">
        {isSuspension ? "Suspend employee" : "Place on leave"}
      </h1>
      <p className="mt-1 text-sm text-zinc-500">
        {employee.firstName} {employee.lastName} — this is recorded as a dated event and
        audited. The employee keeps their title and pay; only their status changes.
      </p>
      <StatusChangeForm employeeId={id} type={type} />
    </main>
  );
}
