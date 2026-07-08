import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewer, canEditEmployee } from "@hris/auth";
import { getEmployeeSummary } from "@/lib/queries";
import { EmployeeSidebar } from "@/components/EmployeeSidebar";
import { TabNav } from "@/components/TabNav";

// In Next 16 route `params` is async — await it before reading `id`.
export async function generateMetadata({ params }) {
  const { id } = await params;
  const s = await getEmployeeSummary(id); // deduped with the layout body via cache()
  return { title: s ? `${s.name} · PeopleBase` : "Employee · PeopleBase" };
}

// Shared shell for every employee profile tab. The sidebar + tab bar live here so they persist
// (and aren't re-fetched) while the user switches between Overview / History / Documents / etc.
// Because this layout runs for ALL sub-routes, its data query (getEmployeeSummary) is
// deliberately audit-free — see the note on that query.
export default async function EmployeeProfileLayout({ children, params }) {
  const { id } = await params;
  const [summary, viewer] = await Promise.all([getEmployeeSummary(id), getViewer()]);

  // RLS hid the employee (or no session) → 404 for the whole profile, tabs included.
  if (!summary) notFound();

  const isSubject = viewer?.employeeId === id;
  // Access & RBAC is an HR/self-only view: a manager browsing a report doesn't see the tab
  // (and the route re-checks server-side, so a deep link 404s too).
  const showAccess = Boolean((viewer && canEditEmployee(viewer)) || isSubject);

  const base = `/employees/${id}`;
  const tabs = [
    { href: base, label: "Overview" },
    { href: `${base}/history`, label: "History" },
    { href: `${base}/documents`, label: "Documents" },
    ...(showAccess ? [{ href: `${base}/access`, label: "Access & RBAC" }] : []),
    { href: `${base}/audit`, label: "Audit log" },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <Link
        href="/employees"
        className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
      >
        ← All employees
      </Link>

      <div className="mt-4 grid grid-cols-1 gap-8 lg:grid-cols-[280px_1fr]">
        <EmployeeSidebar s={summary} />
        <div className="min-w-0">
          <TabNav tabs={tabs} />
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
