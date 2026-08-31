import Link from "next/link";
import { INTL_LOCALE, formatDate, formatMoney } from "@hris/ui";
import { getT, getLocale } from "@/lib/i18n.server";
import { getPublishedJobs } from "@/lib/queries";
import { SiteHeader, SiteFooter, SalaryRange } from "@/components/site-ui";

// PUBLIC — this is the suite's front door. Anyone on the internet reads this page with no session.
//
// Only advertised postings appear, and only the columns app_public_jobs() exposes: no openings
// count, no hiring team, no department, no application data. The page does no filtering of its own,
// deliberately — the doorway has already decided, and a second filter here would just be a second
// place for the rule to drift.
export default async function HomePage() {
  const t = await getT();
  const locale = INTL_LOCALE[await getLocale()];
  const jobs = await getPublishedJobs();

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-semibold tracking-tight">{t("careers.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("careers.subtitle")}</p>

        {/* An empty list is a REAL state, not an error: a company with nothing open should say so
            plainly rather than render a blank page that reads as broken. */}
        {jobs.length === 0 ? (
          <p className="mt-10 rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            {t("careers.empty")}
          </p>
        ) : (
          <ul className="mt-8 flex flex-col gap-3">
            {jobs.map((j) => (
              <li key={j.id}>
                <Link
                  href={`/jobs/${j.id}`}
                  className="block rounded-xl border border-border bg-card p-5 transition-colors hover:border-ring"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-medium">{j.title}</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {[j.location, t(`enum.employmentType.${j.employmentType}`)].filter(Boolean).join(" · ")}
                      </p>
                      <div className="mt-1">
                        <SalaryRange
                          job={j}
                          formatMoney={formatMoney}
                          locale={locale}
                          basisLabel={j.payBasis ? t(`enum.payBasis.${j.payBasis}`) : null}
                        />
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">
                        {t("careers.posted", { date: formatDate(j.publishedAt, locale) })}
                      </p>
                      <p className="mt-1 text-sm text-primary">{t("careers.view")}</p>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
