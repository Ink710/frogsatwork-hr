"use client";

import { useT, ErrorBox } from "@hris/ui/client";

// Error boundaries must be Client Components — React needs to catch a render/runtime
// error on the client and offer a recovery path. If getEmployees() throws (DB down,
// bad query), Next renders this instead of a white screen. `reset()` re-attempts the
// segment. We surface the failure explicitly rather than swallowing it. Wider than the
// app-wide boundary so it matches the employee list it replaces.
export default function Error({ error, reset }) {
  const t = useT();
  return (
    <ErrorBox
      title={t("error.employeesTitle")}
      message={error?.message ?? t("error.generic")}
      actionLabel={t("error.tryAgain")}
      onReset={reset}
      className="mx-auto w-full max-w-5xl px-6 py-10"
    />
  );
}
