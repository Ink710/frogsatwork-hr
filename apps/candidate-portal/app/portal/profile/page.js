import Link from "next/link";
import { redirect } from "next/navigation";
import { getApplicant } from "@/lib/auth";
import { getT } from "@/lib/i18n.server";
import { getMyProfile, getMyResume } from "@/lib/queries";
import { SiteHeader, SiteFooter } from "@/components/site-ui";
import { ProfileForm } from "@/components/ProfileForm";
import { ResumePanel } from "@/components/ResumePanel";

export const metadata = { title: "Your profile · FrogsAtWorkHR" };

// The record an applicant maintains about themselves (M7).
//
// Same three-layer posture as /portal: the proxy is an edge gate, this page refuses to render
// without an applicant, and underneath both the doorways scope every row to this account id — so a
// page that forgot to check would still have nothing to show.
export default async function ProfilePage() {
  const applicant = await getApplicant();
  if (!applicant) redirect("/sign-in");

  const t = await getT();
  const [profile, resume] = await Promise.all([
    getMyProfile(applicant.accountId),
    getMyResume(applicant.accountId),
  ]);

  // getMyProfile returns null for an account the doorway will not serve — closed on hire, or a
  // candidate that has been erased. Both are real states for someone holding a valid JWT, since
  // nothing is looked up per request. Say so plainly rather than rendering an empty form that
  // would fail on save.
  if (!profile) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 sm:px-6">
          <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            {t("profile.unavailable")}
          </p>
        </main>
        <SiteFooter />
      </>
    );
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t("profile.title")}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{t("profile.subtitle")}</p>
          </div>
          <Link href="/portal" className="text-sm text-primary hover:underline">
            {t("profile.backToApplications")}
          </Link>
        </div>

        {/* ⚠️ The one thing an applicant is most likely to assume wrongly, so it is said before they
            edit anything rather than after: changes here do not rewrite an application already under
            review. That is M6's snapshot rule, and M7 extends it to the CV. */}
        <p className="mt-6 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          {t("profile.snapshotNote")}
        </p>

        <section className="mt-8 rounded-xl border border-border bg-card p-6">
          <h2 className="text-sm font-semibold">{t("profile.resumeTitle")}</h2>
          <div className="mt-4">
            {/* Only the NAME crosses into the client component — see ResumePanel. */}
            <ResumePanel fileName={resume?.fileName ?? null} />
          </div>
        </section>

        <section className="mt-6 rounded-xl border border-border bg-card p-6">
          <ProfileForm profile={profile} />
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
