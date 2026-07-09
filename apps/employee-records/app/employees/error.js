"use client";

import { useT } from "@/components/LocaleProvider";

// Error boundaries must be Client Components — React needs to catch a render/runtime
// error on the client and offer a recovery path. If getEmployees() throws (DB down,
// bad query), Next renders this instead of a white screen. `reset()` re-attempts the
// segment. We surface the failure explicitly rather than swallowing it.
export default function Error({ error, reset }) {
  const t = useT();
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 dark:border-red-900/50 dark:bg-red-950/30">
        <h2 className="text-lg font-semibold text-red-800 dark:text-red-300">{t("error.employeesTitle")}</h2>
        <p className="mt-1 text-sm text-red-700 dark:text-red-400">
          {error?.message ?? t("error.generic")}
        </p>
        <button
          onClick={reset}
          className="mt-4 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
        >
          {t("error.tryAgain")}
        </button>
      </div>
    </main>
  );
}
