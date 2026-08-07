import { auth, signOut } from "@hris/auth";
import { getT } from "@/lib/i18n.server";
import { AppShellHeader } from "@hris/ui/server";

// Async Server Component: reads the session server-side. Renders nothing when signed out
// (e.g. on /login), so the header only appears once authenticated.
//
// M0 nav is intentionally thin — just "My time" home. Each domain milestone (time off,
// timesheets, scheduling, attendance, approvals) adds its own link here.
export async function AppHeader() {
  const session = await auth();
  if (!session?.user) return null;

  const { name, role } = session.user;
  const t = await getT();

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  // Managers + HR get an approvals queue for their reports/org; HR also gets the accrual policies.
  const isHr = role === "HR_ADMIN" || role === "HR_GENERALIST";
  const isApprover = role === "MANAGER" || isHr;
  // Consolidated nav: related pages are grouped under one entry, switchable via the in-page PageTabs.
  //   My Week   → Schedule + Timesheets
  //   My team   → My team (timesheet review) + Team attendance
  //   Activities → Projects + Meetings
  const navItems = [
    { href: "/", label: t("nav.home") },
    { href: "/time-off", label: t("nav.timeOff") },
    { href: "/schedule", label: t("nav.myWeek") },
    { href: "/attendance", label: t("nav.attendance") },
    isApprover && { href: "/my-team", label: t("nav.myTeam") },
    isApprover && { href: "/projects", label: t("nav.activities") },
    isApprover && { href: "/approvals", label: t("nav.approvals") },
    isHr && { href: "/time-off/policies", label: t("nav.policies") },
  ].filter(Boolean);

  return (
    <AppShellHeader
      navItems={navItems}
      userName={name}
      roleLabel={t(`enum.role.${role}`)}
      prefsLabel={t("nav.preferences")}
      signOutLabel={t("nav.signOut")}
      logout={logout}
    />
  );
}
