import Link from "next/link";
import { APPLICATION_STAGES } from "@hris/recruiting";
import { INTL_LOCALE, formatDate } from "@hris/ui";
import { getT, getLocale } from "@/lib/i18n.server";
import { getCandidates, getCandidateFilterOptions } from "@/lib/queries";
import { StageBadge } from "@/components/recruiting-ui";

// The candidate database. Every filter lives in the URL (a plain GET form), so any view is a
// shareable link and the page stays a pure Server Component — no client state at all.
export default async function CandidatesPage({ searchParams }) {
  const sp = await searchParams; // async in Next 16
  const t = await getT();
  const locale = INTL_LOCALE[await getLocale()];

  const filters = {
    q: sp?.q ?? "",
    stage: sp?.stage ?? "",
    jobId: sp?.jobId ?? "",
    source: sp?.source ?? "",
    appliedFrom: sp?.appliedFrom ?? "",
    appliedTo: sp?.appliedTo ?? "",
    page: Number(sp?.page ?? 1),
  };

  const [{ rows, total, page, pageCount }, options] = await Promise.all([
    getCandidates(filters),
    getCandidateFilterOptions(),
  ]);

  // Preserve every active filter when paging.
  const buildHref = (overrides) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...filters, ...overrides })) {
      if (v && !(k === "page" && v === 1)) params.set(k, String(v));
    }
    const qs = params.toString();
    return qs ? `/candidates?${qs}` : "/candidates";
  };

  const hasFilters = Boolean(
    filters.q || filters.stage || filters.jobId || filters.source || filters.appliedFrom || filters.appliedTo,
  );
  const inputCls =
    "rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("candidates.title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("candidates.subtitle")}</p>

      {/* Filter bar — method=get so state is URL-only (shareable, back-button friendly). */}
      <form method="get" className="mt-6 flex flex-wrap items-end gap-3">
        <input
          type="search"
          name="q"
          defaultValue={filters.q}
          placeholder={t("candidates.search")}
          aria-label={t("candidates.search")}
          className={`${inputCls} min-w-[14rem] flex-1`}
        />
        <select name="stage" defaultValue={filters.stage} aria-label={t("candidates.allStages")} className={inputCls}>
          <option value="">{t("candidates.allStages")}</option>
          {APPLICATION_STAGES.map((s) => (
            <option key={s} value={s}>
              {t(`enum.applicationStage.${s}`)}
            </option>
          ))}
        </select>
        <select name="jobId" defaultValue={filters.jobId} aria-label={t("candidates.allJobs")} className={inputCls}>
          <option value="">{t("candidates.allJobs")}</option>
          {options.jobs.map((j) => (
            <option key={j.id} value={j.id}>
              {j.title}
            </option>
          ))}
        </select>
        {options.sources.length > 0 && (
          <select name="source" defaultValue={filters.source} aria-label={t("candidates.allSources")} className={inputCls}>
            <option value="">{t("candidates.allSources")}</option>
            {options.sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
        <label className="flex flex-col text-xs text-muted-foreground">
          {t("candidates.appliedFrom")}
          <input type="date" name="appliedFrom" defaultValue={filters.appliedFrom} className={`${inputCls} mt-1`} />
        </label>
        <label className="flex flex-col text-xs text-muted-foreground">
          {t("candidates.appliedTo")}
          <input type="date" name="appliedTo" defaultValue={filters.appliedTo} className={`${inputCls} mt-1`} />
        </label>
        <button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
          {t("candidates.filter")}
        </button>
        {hasFilters && (
          <Link href="/candidates" className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            {t("candidates.clear")}
          </Link>
        )}
      </form>

      <p className="mt-4 text-sm text-muted-foreground">
        {t("candidates.count", { n: total, shown: rows.length })}
      </p>

      {rows.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {hasFilters ? t("candidates.noMatch") : t("candidates.empty")}
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {rows.map((c) => (
            <li key={c.id}>
              <Link
                href={`/candidates/${c.id}`}
                className="block rounded-xl border border-border bg-card p-4 transition-colors hover:border-ring"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{c.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">{c.email}</p>
                    {c.source && <p className="mt-0.5 text-xs text-muted-foreground">{c.source}</p>}
                  </div>
                  <div className="text-right">
                    {c.latest ? (
                      <>
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-sm text-muted-foreground">{c.latest.jobTitle}</span>
                          <StageBadge stage={c.latest.stage} label={t(`enum.applicationStage.${c.latest.stage}`)} />
                        </div>
                        <p className="mt-1 font-mono text-xs text-muted-foreground">
                          {t("profile.appliedOn", { date: formatDate(c.latest.appliedAt, locale) })}
                          {c.applicationCount > 1 && (
                            <span className="ml-2 text-primary">
                              {t("candidates.moreApplications", { n: c.applicationCount - 1 })}
                            </span>
                          )}
                        </p>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">{t("candidates.noApplications")}</span>
                    )}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {pageCount > 1 && (
        <nav className="mt-6 flex items-center justify-between text-sm" aria-label="Pagination">
          {page > 1 ? (
            <Link href={buildHref({ page: page - 1 })} className="rounded-md border border-border px-3 py-1.5 font-medium hover:bg-muted">
              ← Prev
            </Link>
          ) : (
            <span />
          )}
          <div className="flex gap-1">
            {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
              <Link
                key={p}
                href={buildHref({ page: p })}
                className={`rounded-md px-3 py-1.5 font-medium ${
                  p === page ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"
                }`}
              >
                {p}
              </Link>
            ))}
          </div>
          {page < pageCount ? (
            <Link href={buildHref({ page: page + 1 })} className="rounded-md border border-border px-3 py-1.5 font-medium hover:bg-muted">
              Next →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  );
}
