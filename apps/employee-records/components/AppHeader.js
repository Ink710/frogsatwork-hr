import Link from "next/link";
import { auth, signOut, getViewer } from "@hris/auth";
import { getT } from "@/lib/i18n.server";
import { Logo } from "@/components/Logo";
import { MobileMenu } from "@/components/MobileMenu";

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
    <header className="border-b border-border bg-card/40">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        {/* Left: logo + (desktop) nav */}
        <div className="flex items-center gap-6">
          <Logo href="/" />
          <nav className="hidden items-center gap-4 text-sm text-muted-foreground md:flex">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href} className="hover:text-foreground">
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        {/* Right (desktop ≥ md): name + role + preferences + sign out */}
        <div className="hidden items-center gap-4 text-sm md:flex">
          <span className="text-muted-foreground">
            {name} · <span className="text-muted-foreground/70">{t(`enum.role.${role}`)}</span>
          </span>
          <Link href="/preferences" className="text-muted-foreground hover:text-foreground">
            {t("nav.preferences")}
          </Link>
          <form action={logout}>
            <button className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted">
              {t("nav.signOut")}
            </button>
          </form>
        </div>

        {/* Right (mobile < md): just the name + a collapsible menu with everything else */}
        <div className="flex items-center gap-3 md:hidden">
          <span className="max-w-[45vw] truncate text-sm text-muted-foreground">{name}</span>
          <MobileMenu
            navItems={navItems}
            prefsHref="/preferences"
            prefsLabel={t("nav.preferences")}
            signOutLabel={t("nav.signOut")}
            logout={logout}
          />
        </div>
      </div>
    </header>
  );
}
