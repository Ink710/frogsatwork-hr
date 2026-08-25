import { auth, signOut, isRecruiter } from "@hris/auth";
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

  // The leads pool is a SOURCING tool, and sourcing is a recruiter's job (M16, revised).
  //
  // ⚠️ WHY THIS IS ROLE-GATED WHERE THE JOBS AND CANDIDATES LINKS ARE NOT. Those two are honest when
  // RLS narrows them: a hiring manager's job list IS their jobs, and it says so. The leads pool is
  // different — its value is finding someone from a req you were NOT on, so an RLS-narrowed pool
  // shows a manager a fraction while looking like the whole thing. Someone seeing 3 leads and
  // concluding that's all there is, when there are 40, is the trap M9 avoided by hiding the
  // interviewer-load report outright: a wrong number is worse than a hidden section.
  //
  // Managers still MARK leads — their judgement is exactly what fills this list. They just aren't
  // its audience. (Mirrors compliance: the page 404s regardless; this only stops advertising a door
  // that won't open.)
  // `isRecruiter` is a pure role predicate (no DB round-trip), so reusing it here costs nothing and
  // keeps "who is a recruiter" in one place rather than restating the role list.
  const canSeeLeads = isRecruiter(role);

  return (
    <AppShellHeader
      navItems={[
        { href: "/", label: t("nav.jobs") },
        { href: "/candidates", label: t("nav.candidates") },
        ...(canSeeLeads ? [{ href: "/candidates/leads", label: t("nav.leads") }] : []),
        // M9: ungated on purpose, unlike the links below. Anyone on a hiring team can be proposed
        // as an interviewer, and the page scopes itself to slots that are actually theirs — so it is
        // empty rather than forbidden for everyone else. Gating it by role would hide the one
        // surface an INTERVIEWER (who cannot reach /jobs/[id]/manage at all) needs.
        { href: "/interviews", label: t("nav.interviews") },
        { href: "/reports", label: t("nav.reports") },
        // M2: same gate as the leads pool — `isRecruiter` is the campaign_write role list, so the
        // link only appears for people the database will actually let maintain the registry. The
        // page 404s regardless; this just stops advertising a door that won't open.
        ...(canSeeLeads ? [{ href: "/campaigns", label: t("nav.campaigns") }] : []),
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
