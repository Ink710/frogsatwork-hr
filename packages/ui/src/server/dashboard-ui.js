import Link from "next/link";

// A single dashboard metric tile. Optionally a link (whole card clickable) with a Lucide icon.
// Mirrors the employee-records dashboard StatCard so the two apps read as one product.
export function StatCard({ label, value, hint, href, icon: Icon }) {
  const body = (
    <>
      <div className="flex items-start justify-between">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground/70" aria-hidden="true" />}
      </div>
      <p className="mt-1 text-3xl font-semibold tracking-tight">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </>
  );
  const cls = "block rounded-xl border border-border bg-card p-5";
  return href ? (
    <Link href={href} className={`${cls} transition-colors hover:border-ring`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

// A titled dashboard section with an optional leading icon.
export function Section({ title, icon: Icon, children }) {
  return (
    <section className="mt-10">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
        {title}
      </h2>
      {children}
    </section>
  );
}
