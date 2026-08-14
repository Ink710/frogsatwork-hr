// Small presentational primitives for the ATS. Dumb by design: the caller (which has the request's
// translator) passes an already-translated `label`, so these stay server/client agnostic.

const STAGE_TONE = {
  APPLIED: "bg-muted text-muted-foreground",
  SCREEN: "bg-info/10 text-info",
  INTERVIEW: "bg-warning/10 text-warning",
  OFFER: "bg-primary/10 text-primary",
  HIRED: "bg-success/10 text-success",
  REJECTED: "bg-destructive/10 text-destructive",
  WITHDRAWN: "bg-muted text-muted-foreground",
};

const JOB_STATUS_TONE = {
  DRAFT: "bg-muted text-muted-foreground",
  OPEN: "bg-success/10 text-success",
  PAUSED: "bg-warning/10 text-warning",
  CLOSED: "bg-muted text-muted-foreground",
  FILLED: "bg-info/10 text-info",
};

export function StageBadge({ stage, label }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STAGE_TONE[stage] ?? STAGE_TONE.APPLIED}`}>
      {label}
    </span>
  );
}

// A verdict badge. Greens for yes, reds for no — no neutral tone, because the scale has no neutral.
const RECOMMENDATION_TONE = {
  STRONG_YES: "bg-success/15 text-success",
  YES: "bg-success/10 text-success",
  NO: "bg-destructive/10 text-destructive",
  STRONG_NO: "bg-destructive/15 text-destructive",
};

export function RecommendationBadge({ recommendation, label }) {
  if (!recommendation) return null;
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
        RECOMMENDATION_TONE[recommendation] ?? "bg-muted text-muted-foreground"
      }`}
    >
      {label}
    </span>
  );
}

/**
 * The posted pay range on a public listing (M14).
 *
 * Renders NOTHING when the figures are absent, and that absence covers two different situations on
 * purpose: the req has no band, or it has one the operator chose not to post. app_public_jobs()
 * returns NULLs for both, so a visitor cannot tell them apart — the careers page must not become a
 * way to ask whether an unadvertised band exists.
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

/**
 * A download link for a candidate's résumé.
 *
 * Dumb like everything else here: the CALLER signs the href, because signing needs the viewer's user
 * id and a signed link is a short-lived credential rather than a piece of layout. Renders nothing
 * when there is no file — which covers "never uploaded one" and "erased" identically, matching what
 * the route itself does.
 */
export function ResumeLink({ href, fileName, label }) {
  if (!href || !fileName) return null;
  return (
    <a
      href={href}
      className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
      // Not a client-side navigation: it's a file response, not a page.
      download
    >
      <span aria-hidden="true">↓</span>
      <span>{label}</span>
      <span className="font-mono text-xs text-muted-foreground">{fileName}</span>
    </a>
  );
}

export function JobStatusBadge({ status, label }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${JOB_STATUS_TONE[status] ?? JOB_STATUS_TONE.DRAFT}`}>
      {label}
    </span>
  );
}
