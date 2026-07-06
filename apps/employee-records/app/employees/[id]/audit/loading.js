// Suspense fallback while the audit page awaits its first batch of events.
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="h-5 w-28 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="mt-4 h-8 w-40 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="mt-8 space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-14 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
        ))}
      </div>
    </main>
  );
}
