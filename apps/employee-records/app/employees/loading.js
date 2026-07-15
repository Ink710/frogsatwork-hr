// Shown automatically while the Server Component above awaits its data. Next wraps
// the route in a <Suspense> boundary using this file as the fallback — no manual
// loading state needed in the page itself.
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="mb-6 h-8 w-40 animate-pulse rounded bg-muted " />
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-11 animate-pulse rounded bg-muted " />
        ))}
      </div>
    </main>
  );
}
