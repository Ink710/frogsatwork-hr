import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewer } from "@hris/auth";
import { INTL_LOCALE, formatDate } from "@hris/ui";
import { getT, getLocale } from "@/lib/i18n.server";
import { getLeadPool, canBrowseLeadPool } from "@/lib/queries";

/**
 * The great-leads pool (M16) — people worth calling when the next role opens.
 *
 * ⚠️ THIS IS A SEPARATE PAGE RATHER THAN A FILTER ON /candidates, and the reason is the milestone's
 * central decision. Leads are swept by the retention policy like everyone else, so a filter on the
 * candidate list — which hides archived rows by default, correctly — would quietly empty this
 * feature about a year after launch. The pool shows archived leads on purpose, with a pill, which is
 * how the retention promise and the feature survive together.
 *
 * ⚠️ RECRUITERS AND HR ONLY, which is deliberately NARROWER than who may mark a lead. A hiring
 * manager's view would be RLS-narrowed to candidates from their own reqs — a fraction of the pool,
 * presented as the pool — and the whole point of sourcing here is finding someone from a req you
 * weren't on. See getLeadPool for the full argument. 404 rather than a message, matching /compliance:
 * a 404 doesn't confirm the page exists.
 */
export default async function LeadsPage({ searchParams }) {
  const sp = await searchParams; // async in Next 16
  const t = await getT();
  const locale = INTL_LOCALE[await getLocale()];

  if (!canBrowseLeadPool(await getViewer())) notFound();

  const q = sp?.q ?? "";
  const page = Number(sp?.page ?? 1);
  const { rows, total, page: current, pageCount } = await getLeadPool({ q, page });

  const buildHref = (overrides) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ q, page: current, ...overrides })) {
      if (!v || (k === "page" && v === 1)) continue;
      params.set(k, String(v));
    }
    const qs = params.toString();
    return qs ? `/candidates/leads?${qs}` : "/candidates/leads";
  };

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6">
      <Link href="/candidates" className="text-sm text-muted-foreground hover:text-foreground">
        {t("lead.backToCandidates")}
      </Link>

      <h1 className="mt-3 text-2xl font-semibold tracking-tight">{t("lead.poolTitle")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("lead.poolSubtitle")}</p>

      {/* GET form, so the search lives in the URL and any view is a shareable link — same discipline
          as the candidate list's filter bar. */}
      <form method="get" className="mt-6 flex flex-wrap items-end gap-3">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder={t("lead.searchPlaceholder")}
          aria-label={t("lead.searchPlaceholder")}
          className="min-w-[16rem] flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
        />
        <button
          type="submit"
          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          {t("lead.searchButton")}
        </button>
      </form>

      <p className="mt-4 text-sm text-muted-foreground">{t("lead.count", { n: total })}</p>

      {rows.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {q ? t("lead.noMatch") : t("lead.empty")}
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {rows.map((c) => (
            <li key={c.id}>
              <Link
                href={`/candidates/${c.id}`}
                className="block rounded-xl border border-border bg-card p-4 transition-colors hover:border-ring"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{c.name}</p>
                      {/* Archived leads belong here — see the note at the top of this file. The pill
                          is the honest signal that they've fallen out of the active pool. */}
                      {c.archivedAt && (
                        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                          {t("archive.badge")}
                        </span>
                      )}
                    </div>
                    <p className="font-mono text-xs text-muted-foreground">{c.email}</p>
                    {c.leadNote && <p className="mt-1.5 max-w-prose text-sm">{c.leadNote}</p>}
                  </div>
                  <p className="text-right text-xs text-muted-foreground">
                    {t("lead.markedOn", { date: formatDate(c.leadMarkedAt, locale) })}
                    {c.leadMarkedByName && (
                      <span className="mt-0.5 block">{t("lead.markedBy", { name: c.leadMarkedByName })}</span>
                    )}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {pageCount > 1 && (
        <nav className="mt-6 flex items-center justify-between text-sm" aria-label="Pagination">
          {current > 1 ? (
            <Link
              href={buildHref({ page: current - 1 })}
              className="rounded-md border border-border px-3 py-1.5 font-medium hover:bg-muted"
            >
              ← Prev
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground">
            {current} / {pageCount}
          </span>
          {current < pageCount ? (
            <Link
              href={buildHref({ page: current + 1 })}
              className="rounded-md border border-border px-3 py-1.5 font-medium hover:bg-muted"
            >
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
