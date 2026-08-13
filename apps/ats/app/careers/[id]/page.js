import Link from "next/link";
import { notFound } from "next/navigation";
import { INTL_LOCALE, formatMoney } from "@hris/ui";
import { getT, getLocale } from "@/lib/i18n.server";
import { getPublishedJob } from "@/lib/queries";
import { ApplyForm } from "@/components/ApplyForm";
import { SalaryRange } from "@/components/recruiting-ui";

// PUBLIC. notFound() unless the posting is OPEN *and* published — so guessing the id of a draft,
// paused or confidential req reveals nothing (the DB function enforces the same rule on submit).
export default async function CareersJobPage({ params }) {
  const { id } = await params; // async in Next 16
  const t = await getT();
  const locale = INTL_LOCALE[await getLocale()];
  const job = await getPublishedJob(id);
  if (!job) notFound();

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-12 sm:px-6">
      <Link href="/careers" className="text-sm text-muted-foreground hover:text-foreground">
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

      <section className="mt-10">
        <h2 className="text-xl font-semibold tracking-tight">{t("apply.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("apply.subtitle")}</p>
        <div className="mt-4 rounded-xl border border-border bg-card p-6">
          <ApplyForm jobId={id} />
        </div>
      </section>
    </main>
  );
}
