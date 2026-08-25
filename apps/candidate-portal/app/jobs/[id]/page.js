import Link from "next/link";
import { notFound } from "next/navigation";
import { INTL_LOCALE, formatMoney } from "@hris/ui";
import { getT, getLocale } from "@/lib/i18n.server";
import { getPublishedJob } from "@/lib/queries";
import { SiteHeader, SiteFooter, SalaryRange } from "@/components/site-ui";

// PUBLIC. notFound() unless the posting is OPEN *and* published — so guessing the id of a draft,
// paused or confidential req is indistinguishable from guessing an id that never existed. That
// equivalence is the point: a different response for "exists but hidden" would turn this page into a
// way to enumerate unannounced roles.
export default async function JobDetailPage({ params, searchParams }) {
  const { id } = await params; // async in Next 16
  // M6: carry a tracking link's campaign slug through to the apply form, so attribution survives the
  // click from listing to submission.
  const sp = await searchParams;
  const source = typeof sp?.source === "string" ? sp.source : null;
  const t = await getT();
  const locale = INTL_LOCALE[await getLocale()];
  const job = await getPublishedJob(id);
  if (!job) notFound();

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-12 sm:px-6">
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          {t("careers.back")}
        </Link>

        <h1 className="mt-3 text-3xl font-semibold tracking-tight">{job.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {[job.location, t(`enum.employmentType.${job.employmentType}`)].filter(Boolean).join(" · ")}
        </p>
        <div className="mt-2">
          <SalaryRange
            job={job}
            formatMoney={formatMoney}
            locale={locale}
            basisLabel={job.payBasis ? t(`enum.payBasis.${job.payBasis}`) : null}
          />
        </div>

        {job.description && (
          <div className="mt-8 rounded-xl border border-border bg-card p-6">
            <p className="whitespace-pre-line text-sm leading-relaxed">{job.description}</p>
          </div>
        )}

        {/* M6: this app is the front door now, so applying happens here. The campaign slug rides
            along so a tracked link keeps its attribution across the click from listing to form. */}
        <Link
          href={`/jobs/${id}/apply${source ? `?source=${encodeURIComponent(source)}` : ""}`}
          className="mt-8 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {t("job.apply")}
        </Link>
      </main>
      <SiteFooter />
    </>
  );
}
