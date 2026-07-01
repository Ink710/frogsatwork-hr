import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-6 py-24">
      <p className="text-sm font-medium uppercase tracking-wide text-zinc-400">
        PeopleBase
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">
        Employee Records
      </h1>
      <p className="mt-3 max-w-md text-zinc-600 dark:text-zinc-400">
        The canonical source of truth for who works here, who they report to, and
        how their records change over time.
      </p>
      <Link
        href="/employees"
        className="mt-6 inline-flex w-fit items-center rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-colors hover:opacity-90"
      >
        View employees →
      </Link>
    </main>
  );
}
