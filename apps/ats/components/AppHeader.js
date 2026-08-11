import { auth, signOut } from "@hris/auth";
import { getT } from "@/lib/i18n.server";
import { AppShellHeader } from "@hris/ui/server";

// Async Server Component: reads the session server-side. Renders nothing when signed out (e.g. on
// /login), so the header only appears once authenticated. The CHROME lives in @hris/ui
// (AppShellHeader); what stays here is the app-specific part — session + which nav links exist.
//
// M2 nav is intentionally thin — just "Jobs". Access to individual jobs is scoped by RLS (hiring
// team), so no role gate is needed here: a user with no reqs simply sees an empty jobs list.
export async function AppHeader() {
  const session = await auth();
  if (!session?.user) return null;

  const { name, role } = session.user;
  const t = await getT();

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  // Compliance is the one role-gated link (M10). The page 404s for anyone else regardless — this
  // only stops the app advertising a door that won't open. The gate is a plain role check rather
  // than a DB round-trip because a nav bar rendered on every page shouldn't cost a query; the
  // authority remains the DB functions the page itself calls.
  //
  // Widened to HR_GENERALIST in M12, matching app_can_read_eeo(): a generalist can now see the
  // suppressed aggregates and file the EEO-1's summary half. What they still cannot do — download
  // exact counts, erase a candidate — is gated per SECTION on the page, not by hiding the whole
  // thing from them.
  const canSeeCompliance = role === "HR_ADMIN" || role === "HR_GENERALIST";

  return (
    <AppShellHeader
      navItems={[
        { href: "/", label: t("nav.jobs") },
        { href: "/candidates", label: t("nav.candidates") },
        { href: "/reports", label: t("nav.reports") },
        ...(canSeeCompliance ? [{ href: "/compliance", label: t("nav.compliance") }] : []),
      ]}
      userName={name}
      roleLabel={t(`enum.role.${role}`)}
      prefsLabel={t("nav.preferences")}
      signOutLabel={t("nav.signOut")}
      logout={logout}
      maxWidth="max-w-6xl"
    />
  );
}
