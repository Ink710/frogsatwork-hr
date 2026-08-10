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

export function JobStatusBadge({ status, label }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${JOB_STATUS_TONE[status] ?? JOB_STATUS_TONE.DRAFT}`}>
      {label}
    </span>
  );
}
