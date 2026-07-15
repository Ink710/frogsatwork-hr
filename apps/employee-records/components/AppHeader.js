import Link from "next/link";
import { auth, signOut, getViewer } from "@hris/auth";
import { getT } from "@/lib/i18n.server";
import { Logo } from "@/components/Logo";

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

  return (
    <header className="border-b border-border bg-card/40">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-6">
          <Logo href="/" />
          <nav className="flex items-center gap-4 text-sm text-muted-foreground">
            {isEmployee ? (
              // An employee's world is just their own profile + the company org chart.
              <Link href={viewer?.employeeId ? `/employees/${viewer.employeeId}` : "/employees"} className="hover:text-foreground">
                {t("nav.myProfile")}
              </Link>
            ) : (
              <>
                <Link href="/dashboard" className="hover:text-foreground">{t("nav.dashboard")}</Link>
                <Link href="/employees" className="hover:text-foreground">{t("nav.employees")}</Link>
                <Link href="/departments" className="hover:text-foreground">{t("nav.departments")}</Link>
              </>
            )}
            <Link href="/org-chart" className="hover:text-foreground">{t("nav.orgChart")}</Link>
            {role === "HR_ADMIN" && (
              <Link href="/settings" className="hover:text-foreground">{t("nav.settings")}</Link>
            )}
          </nav>
        </div>
        <div className="flex items-center gap-4 text-sm">
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
      </div>
    </header>
  );
}
