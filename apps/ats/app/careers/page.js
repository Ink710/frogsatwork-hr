import Link from "next/link";
import { INTL_LOCALE, formatDate, formatMoney } from "@hris/ui";
import { getT, getLocale } from "@/lib/i18n.server";
import { getPublishedJobs } from "@/lib/queries";
import { SalaryRange } from "@/components/recruiting-ui";

// PUBLIC. Anyone on the internet can read this. Only advertised postings appear, and only the
// columns app_public_jobs() exposes — no openings count, no hiring team, no application data.
export const metadata = { title: "Careers · FrogsAtWorkHR" };

export default async function CareersPage() {
  const t = await getT();
  const locale = INTL_LOCALE[await getLocale()];
  const jobs = await getPublishedJobs();

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">{t("careers.title")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t("careers.subtitle")}</p>

      {jobs.length === 0 ? (
        <p className="mt-10 rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          {t("careers.empty")}
        </p>
      ) : (
        <ul className="mt-8 flex flex-col gap-3">
          {jobs.map((j) => (
            <li key={j.id}>
              <Link
                href={`/careers/${j.id}`}
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
                    <p className="font-mono text-xs text-muted-foreground">
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
  );
}
