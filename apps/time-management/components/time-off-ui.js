// Server-safe presentational bits for the time-off views. Semantic tokens only, so they theme
// automatically (light/dark).

const STATUS_STYLES = {
  PENDING: "bg-warning/10 text-warning",
  APPROVED: "bg-success/10 text-success",
  DENIED: "bg-destructive/10 text-destructive",
  CANCELLED: "bg-muted text-muted-foreground",
};

// A pill for a leave-request status. `label` is the translated text; falls back to the raw status.
export function LeaveStatusBadge({ status, label }) {
  return (
    <span className={`rounded-md px-2 py-1 text-xs font-medium ${STATUS_STYLES[status] ?? STATUS_STYLES.CANCELLED}`}>
      {label ?? status}
    </span>
  );
}
