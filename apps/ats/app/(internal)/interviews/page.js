import { INTL_LOCALE } from "@hris/ui";
import { Card } from "@hris/ui/server";
import { getT, getLocale } from "@/lib/i18n.server";
import { getMyPendingConfirmations } from "@/lib/queries";
import { ConfirmationQueue } from "@/components/ConfirmationQueue";

export const metadata = { title: "Interviews · FrogsAtWorkHR" };

// The INTERVIEWER's surface (M9), and the reason decision 3 needed an in-app queue rather than only
// an email.
//
// ⚠️ An interviewer is a JobMember with role INTERVIEWER: they can SEE a req but not MANAGE it, so
// /jobs/[id]/manage — where slots are proposed and published — 404s for them. Without this page
// there would be no way in the product to complete step 2 of the workflow, and the email would link
// somewhere they cannot use. It also works in production, where there is no SMTP provider at all.
//
// Open to everyone: the query is scoped to slots where the viewer IS the assigned interviewer, so a
// recruiter simply sees an empty list rather than a forbidden page.
export default async function InterviewsPage() {
  const t = await getT();
  const locale = INTL_LOCALE[await getLocale()];
  const pending = await getMyPendingConfirmations();

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("slots.queueTitle")}</h1>
      <div className="mt-6">
        <Card title={t("slots.title")}>
          <ConfirmationQueue slots={pending} locale={locale} />
        </Card>
      </div>
    </main>
  );
}
