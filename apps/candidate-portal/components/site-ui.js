import { Logo } from "@hris/ui/client";

/**
 * The public site shell. Brand only — no navigation into anything private, no user chip, nothing
 * that describes the recruiting system behind this site.
 *
 * Modelled on apps/ats/app/careers/layout.js, which makes the same choice for the same reason. The
 * difference here is placement: in the ATS the public shell is a nested layout because the ROOT
 * layout also serves internal pages. In this app the public shell IS the default, so it lives at the
 * top and the future /portal area will nest its own signed-in header inside it (M4/M5).
 */
export function SiteHeader() {
  return (
    <header className="border-b border-border bg-card/40">
      <div className="mx-auto flex max-w-4xl items-center px-4 py-3 sm:px-6">
        <Logo href="/" />
      </div>
    </header>
  );
}

export function SiteFooter({ children }) {
  return (
    <footer className="mt-12 border-t border-border">
      <div className="mx-auto max-w-4xl px-4 py-6 text-xs text-muted-foreground sm:px-6">{children}</div>
    </footer>
  );
}

/**
 * A posted salary range, or nothing.
 *
 * Copied from apps/ats/components/recruiting-ui.js rather than shared, matching how every app in
 * this suite owns its own presentational pieces. Promote it to @hris/ui if a THIRD app needs it.
 *
 * ⚠️ RENDERING NOTHING IS A FEATURE. Two different states produce no output: the req has no salary
 * band at all, or it has one the operator deliberately chose not to publish. app_public_jobs()
 * returns NULLs for both, so a visitor cannot tell them apart — this page must never become a way to
 * ask whether an unadvertised band exists.
 */
export function SalaryRange({ job, formatMoney, locale, basisLabel }) {
  if (job.salaryMin == null || job.salaryMax == null) return null;
  const currency = job.currency ?? "USD";
  return (
    <p className="font-mono text-sm text-foreground">
      {formatMoney(job.salaryMin, currency, locale)} – {formatMoney(job.salaryMax, currency, locale)}
      {basisLabel && <span className="ml-1 font-sans text-xs text-muted-foreground">{basisLabel}</span>}
    </p>
  );
}
