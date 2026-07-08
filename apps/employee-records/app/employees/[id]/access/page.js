import { notFound } from "next/navigation";
import { getEmployeeAccess } from "@/lib/queries";
import { formatDate } from "@/lib/format";
import { Card, Field, FieldGrid, Pill } from "@/components/profile-ui";

// Friendly role labels (humanize() would give "Hr admin"; HR/roles want specific casing).
const ROLE_LABEL = {
  HR_ADMIN: "HR Admin",
  HR_GENERALIST: "HR Generalist",
  PAYROLL_ADMIN: "Payroll Admin",
  MANAGER: "Manager",
  EMPLOYEE: "Employee",
  SYSTEM: "System",
};

// What the employee's role can SEE (records) — mirrors getRecordScope + RLS.
const RECORD_SCOPE_DESC = {
  ALL: "All employee records across the organization",
  SUBTREE: "Their own record plus their direct and indirect reports",
  SELF: "Their own record only",
};

// What the role can see of COMPENSATION — mirrors canViewCompensation.
const COMP_DESC = {
  HR_ADMIN: "All employees, except their own superiors and same-level peers",
  HR_GENERALIST: "All employees, except their own superiors and same-level peers",
  PAYROLL_ADMIN: "All employees — every compensation view is audited",
  MANAGER: "Themselves and their reporting line",
  EMPLOYEE: "Their own compensation only",
  SYSTEM: "—",
};

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

// Access & RBAC tab. Gated to HR or the subject (a manager viewing a report gets null → 404,
// and the tab isn't offered). Read-only: it explains what this person's role grants.
export default async function EmployeeAccessPage({ params }) {
  const { id } = await params;
  const data = await getEmployeeAccess(id);
  if (!data) notFound();

  const { role, activation, capabilities } = data;

  let accountStatus;
  if (activation.emailVerifiedAt) {
    accountStatus = <span className="text-green-700 dark:text-green-400">Activated · {formatDate(activation.emailVerifiedAt)}</span>;
  } else if (activation.invitedAt) {
    accountStatus = <span className="text-amber-700 dark:text-amber-400">Invite pending · sent {formatDate(activation.invitedAt)}</span>;
  } else {
    accountStatus = <span className="text-zinc-500">Not invited</span>;
  }

  return (
    <div className="space-y-6">
      <Card title="System access" action={<Pill>{ROLE_LABEL[role] ?? role}</Pill>}>
        <FieldGrid>
          <Field label="Login email">{data.email}</Field>
          <Field label="Account status">{accountStatus}</Field>
          <Field label="Record visibility">{RECORD_SCOPE_DESC[capabilities.recordScope]}</Field>
          <Field label="Compensation visibility">{COMP_DESC[role] ?? "—"}</Field>
        </FieldGrid>
      </Card>

      <Card title="Permissions">
        <ul className="space-y-3">
          <CheckRow ok={capabilities.editRecords}>Edit employee records &amp; record dated changes</CheckRow>
          <CheckRow ok={capabilities.editCompensation}>Change or correct compensation</CheckRow>
          <CheckRow ok={capabilities.terminate}>Terminate &amp; rehire employees</CheckRow>
          <CheckRow ok={capabilities.manageDepartments}>Manage departments, heads &amp; budgets</CheckRow>
          <CheckRow ok={capabilities.manageSettings}>Manage application settings</CheckRow>
        </ul>
        <p className="mt-5 text-xs text-zinc-400 dark:text-zinc-500">
          These reflect what this employee&rsquo;s role grants. Record visibility is additionally
          enforced by row-level security in the database, not just the UI.
        </p>
      </Card>
    </div>
  );
}
