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

  return (
    <AppShellHeader
      navItems={[{ href: "/", label: t("nav.jobs") }]}
      userName={name}
      roleLabel={t(`enum.role.${role}`)}
      prefsLabel={t("nav.preferences")}
      signOutLabel={t("nav.signOut")}
      logout={logout}
      maxWidth="max-w-6xl"
    />
  );
}
