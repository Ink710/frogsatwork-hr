import Link from "next/link";
import { Logo } from "../client/Logo";
import { MobileMenu } from "../client/MobileMenu";

// The suite's app header CHROME — purely presentational, so all three apps look like one product.
// Deciding *what* goes in the nav (session, roles, per-app routes) is genuinely app-specific, so each
// app keeps a thin `components/AppHeader.js` that resolves the session, builds `navItems`, and renders
// this. Pass already-translated strings: this component never touches i18n.
//
//   navItems: [{ href, label }]  ·  logout: a server action  ·  maxWidth: the app's content width
export function AppShellHeader({
  navItems = [],
  userName,
  roleLabel,
  prefsHref = "/preferences",
  prefsLabel,
  signOutLabel,
  logout,
  homeHref = "/",
  maxWidth = "max-w-5xl",
}) {
  return (
    <header className="border-b border-border bg-card/40">
      <div className={`mx-auto flex ${maxWidth} items-center justify-between gap-4 px-4 py-3 sm:px-6`}>
        {/* Left: logo + (desktop) nav */}
        <div className="flex items-center gap-6">
          <Logo href={homeHref} />
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
            {userName} · <span className="text-muted-foreground/70">{roleLabel}</span>
          </span>
          <Link href={prefsHref} className="text-muted-foreground hover:text-foreground">
            {prefsLabel}
          </Link>
          <form action={logout}>
            <button className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted">
              {signOutLabel}
            </button>
          </form>
        </div>

        {/* Right (mobile < md): name + a collapsible menu with everything else */}
        <div className="flex items-center gap-3 md:hidden">
          <span className="max-w-[45vw] truncate text-sm text-muted-foreground">{userName}</span>
          <MobileMenu
            navItems={navItems}
            prefsHref={prefsHref}
            prefsLabel={prefsLabel}
            signOutLabel={signOutLabel}
            logout={logout}
          />
        </div>
      </div>
    </header>
  );
}
