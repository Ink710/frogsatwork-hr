// Fallback while the audit tab awaits its first batch of events (renders inside the profile
// layout's content slot, so no full-page wrapper).
export default function Loading() {
  return (
    <div className="rounded-xl border border-border bg-card p-6  /40" aria-busy="true">
      <div className="mb-5 h-5 w-40 animate-pulse rounded bg-muted " />
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-14 animate-pulse rounded bg-muted " />
        ))}
      </div>
    </div>
  );
}
