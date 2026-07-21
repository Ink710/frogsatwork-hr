import Link from "next/link";
import { auth, signOut } from "@hris/auth";
import { getT } from "@/lib/i18n.server";
import { Logo } from "@/components/Logo";
import { MobileMenu } from "@/components/MobileMenu";

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
  const navItems = [
    { href: "/", label: t("nav.home") },
    { href: "/time-off", label: t("nav.timeOff") },
    { href: "/timesheets", label: t("nav.timesheets") },
    { href: "/schedule", label: t("nav.schedule") },
    isApprover && { href: "/approvals", label: t("nav.approvals") },
    isHr && { href: "/time-off/policies", label: t("nav.policies") },
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

        {/* Right (mobile < md): name + collapsible menu with everything else */}
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
