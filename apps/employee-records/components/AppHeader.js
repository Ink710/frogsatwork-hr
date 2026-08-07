import { auth, signOut, getViewer } from "@hris/auth";
import { getT } from "@/lib/i18n.server";
import { AppShellHeader } from "@hris/ui/server";

// Async Server Component: reads the session server-side. Renders nothing when signed
// out (e.g. on /login), so the header only appears once authenticated.
export async function AppHeader() {
  const session = await auth();
  if (!session?.user) return null;

  const { name, role } = session.user;
  const [viewer, t] = await Promise.all([getViewer(), getT()]);
  const isEmployee = role === "EMPLOYEE";

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  // Nav links, computed once and shared by the desktop nav + the mobile collapsible menu.
  // An employee's world is just their own profile + the company org chart; everyone else gets
  // the dashboard/employees/departments; only HR_ADMIN sees settings.
  const navItems = [
    isEmployee
      ? { href: viewer?.employeeId ? `/employees/${viewer.employeeId}` : "/employees", label: t("nav.myProfile") }
      : { href: "/dashboard", label: t("nav.dashboard") },
    !isEmployee && { href: "/employees", label: t("nav.employees") },
    !isEmployee && { href: "/departments", label: t("nav.departments") },
    { href: "/org-chart", label: t("nav.orgChart") },
    role === "HR_ADMIN" && { href: "/settings", label: t("nav.settings") },
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
