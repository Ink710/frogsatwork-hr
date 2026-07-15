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
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6  ">
        <h2 className="text-lg font-semibold text-destructive ">{t("error.employeesTitle")}</h2>
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
