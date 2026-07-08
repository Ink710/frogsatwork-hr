import Link from "next/link";
import { formatDate, formatTenure, initials } from "@/lib/format";
import { Avatar, StatusBadge } from "@/components/profile-ui";

// Minimal inline icon set (16px, currentColor) so the sidebar matches the mockup without a
// dependency. Keyed by name; unknown names render nothing.
const ICONS = {
  id: "M4 6h16v12H4zM8 10h.01M8 14h4",
  building: "M4 20V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v15M15 8h3a1 1 0 0 1 1 1v11M8 8h.01M8 12h.01M11 8h.01M11 12h.01",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM5 20a7 7 0 0 1 14 0",
  pin: "M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11ZM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  calendar: "M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2",
  mail: "M4 6h16v12H4zM4 7l8 6 8-6",
  phone: "M4 5a1 1 0 0 1 1-1h3l2 5-2 1a11 11 0 0 0 5 5l1-2 5 2v3a1 1 0 0 1-1 1A16 16 0 0 1 4 5Z",
};

function Icon({ name }) {
  const d = ICONS[name];
  if (!d) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

function InfoRow({ icon, label, children }) {
  return (
    <div className="flex gap-3">
      <Icon name={icon} />
      <div className="min-w-0">
        <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
        <div className="mt-0.5 truncate text-sm font-medium">{children ?? "—"}</div>
      </div>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
      {children}
    </h2>
  );
}

// The persistent left identity rail. Rendered by the [id] layout, so it stays put while the
// user switches tabs. `s` is the lean summary from getEmployeeSummary (no compensation).
export function EmployeeSidebar({ s }) {
  const tenure = formatTenure(s.hireDate, s.terminationDate);

  return (
    <aside className="w-full">
      {/* Identity */}
      <div className="flex flex-col items-center text-center">
        <Avatar initials={initials(s.firstName, s.lastName)} />
        <h1 className="mt-4 text-xl font-semibold tracking-tight">{s.name}</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{s.title ?? "—"}</p>
        <div className="mt-2">
          <StatusBadge status={s.employmentStatus} />
        </div>
      </div>

      <hr className="my-6 border-zinc-200 dark:border-zinc-800" />

      {/* Employee info */}
      <SectionLabel>Employee info</SectionLabel>
      <div className="space-y-4">
        <InfoRow icon="id" label="Employee ID">
          <span className="font-mono">{s.employeeNumber}</span>
        </InfoRow>
        <InfoRow icon="building" label="Department">{s.department}</InfoRow>
        <InfoRow icon="user" label="Reports to">
          {s.manager ? (
            <Link href={`/employees/${s.manager.id}`} className="text-blue-600 hover:underline dark:text-blue-400">
              {s.manager.name}
            </Link>
          ) : (
            "—"
          )}
        </InfoRow>
        <InfoRow icon="pin" label="Location">{s.location}</InfoRow>
        <InfoRow icon="calendar" label="Hire date">{formatDate(s.hireDate)}</InfoRow>
        <InfoRow icon="clock" label="Tenure">{tenure}</InfoRow>
      </div>

      <hr className="my-6 border-zinc-200 dark:border-zinc-800" />

      {/* Contact */}
      <SectionLabel>Contact</SectionLabel>
      <div className="space-y-4">
        <InfoRow icon="mail" label="Work email">
          <a href={`mailto:${s.email}`} className="text-blue-600 hover:underline dark:text-blue-400">
            {s.email}
          </a>
        </InfoRow>
        <InfoRow icon="phone" label="Phone">{s.phone}</InfoRow>
      </div>
    </aside>
  );
}
