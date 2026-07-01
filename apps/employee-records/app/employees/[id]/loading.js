export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="h-4 w-24 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="mt-6 h-8 w-56 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="mt-6 h-32 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-900" />
      <div className="mt-8 space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
        ))}
      </div>
    </main>
  );
}
