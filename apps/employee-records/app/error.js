"use client";

import { useT } from "@/components/LocaleProvider";

// App-wide error boundary. Error boundaries must be Client Components — React catches a
// render/runtime error on the client and offers recovery. This is the catch-all: any route
// that throws and has no more-specific error.js (e.g. /employees/error.js) lands here
// instead of a white screen. `reset()` re-renders the failed segment.
export default function Error({ error, reset }) {
  const t = useT();
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16">
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6  ">
        <h2 className="text-lg font-semibold text-destructive ">{t("error.title")}</h2>
        <p className="mt-1 text-sm text-destructive ">
          {error?.message ?? t("error.generic")}
        </p>
        <button
          onClick={reset}
          className="mt-4 rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-white hover:bg-destructive/90"
        >
          {t("error.tryAgain")}
        </button>
      </div>
    </main>
  );
}
