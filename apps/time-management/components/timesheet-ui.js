// Server-safe timesheet status pill (semantic tokens → auto-themes).
const STATUS_STYLES = {
  DRAFT: "bg-muted text-muted-foreground",
  SUBMITTED: "bg-warning/10 text-warning",
  APPROVED: "bg-success/10 text-success",
  REJECTED: "bg-destructive/10 text-destructive",
};

export function TimesheetStatusBadge({ status, label }) {
  return (
    <span className={`rounded-md px-2 py-1 text-xs font-medium ${STATUS_STYLES[status] ?? STATUS_STYLES.DRAFT}`}>
      {label ?? status}
    </span>
  );
}
