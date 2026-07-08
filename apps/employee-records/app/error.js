"use client";

// App-wide error boundary. Error boundaries must be Client Components — React catches a
// render/runtime error on the client and offers recovery. This is the catch-all: any route
// that throws and has no more-specific error.js (e.g. /employees/error.js) lands here
// instead of a white screen. `reset()` re-renders the failed segment.
export default function Error({ error, reset }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16">
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 dark:border-red-900/50 dark:bg-red-950/30">
        <h2 className="text-lg font-semibold text-red-800 dark:text-red-300">
          Something went wrong
        </h2>
        <p className="mt-1 text-sm text-red-700 dark:text-red-400">
          {error?.message ?? "An unexpected error occurred."}
        </p>
        <button
          onClick={reset}
          className="mt-4 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
