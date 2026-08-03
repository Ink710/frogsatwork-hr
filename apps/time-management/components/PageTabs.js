import Link from "next/link";

// The three consolidated groups, each a set of sibling pages under one nav entry. Defined once here so
// every page in a group renders the same tabs. `t` is the request translator (labels reuse nav.* keys).
export const myWeekTabs = (t) => [
  { href: "/schedule", label: t("nav.schedule") },
  { href: "/timesheets", label: t("nav.timesheets") },
];
export const myTeamTabs = (t) => [
  { href: "/my-team", label: t("nav.timesheets") },
  { href: "/attendance/team", label: t("nav.attendance") },
];
export const activitiesTabs = (t) => [
  { href: "/projects", label: t("nav.projects") },
  { href: "/meetings", label: t("nav.meetings") },
];

// A small pill tab-bar that groups related pages under one nav entry (My Week, My team, Activities).
// Server component — just Links, no client state. `tabs` is [{ href, label }]; `active` is the current
// page's href (the tab whose href matches is highlighted). Generalizes the M11 attendance ViewToggle.
export function PageTabs({ tabs, active }) {
  return (
    <div className="mb-6 inline-flex gap-1">
      {tabs.map((tab) => {
        const isActive = tab.href === active;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${
              isActive ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
