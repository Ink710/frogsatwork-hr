import { notFound } from "next/navigation";
import { getT } from "@/lib/i18n.server";
import { getPublishedJob, getMyProfile, getJobQuestions } from "@/lib/queries";
import { getApplicant } from "@/lib/auth";
import { SiteHeader, SiteFooter } from "@/components/site-ui";
import { ApplyForm } from "@/components/ApplyForm";

export const metadata = { title: "Apply · FrogsAtWorkHR" };

// PUBLIC — anyone may apply, signed in or not.
//
// A session is used for ONE thing here: prefilling the form from the applicant's profile. It grants
// nothing. The submission is resolved by email inside app_submit_application either way, so an
// anonymous application and a signed-in one travel exactly the same path.
export default async function ApplyPage({ params, searchParams }) {
  const { id } = await params; // async in Next 16
  const sp = await searchParams;
  const source = typeof sp?.source === "string" ? sp.source : null;

  const t = await getT();
  const job = await getPublishedJob(id);
  if (!job) notFound(); // same 404 as a nonexistent id — an unadvertised req reveals nothing

  const applicant = await getApplicant();
  const [profile, questions] = await Promise.all([
    applicant ? getMyProfile(applicant.accountId) : null,
    getJobQuestions(id),
  ]);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("apply.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{job.title}</p>
        {profile && <p className="mt-3 text-sm text-primary">{t("apply.prefilled")}</p>}

        <div className="mt-6 rounded-xl border border-border bg-card p-6">
          <ApplyForm jobId={id} source={source} profile={profile} questions={questions} />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
