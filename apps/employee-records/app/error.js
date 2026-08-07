"use client";

import { useT, ErrorBox } from "@hris/ui/client";

// App-wide error boundary. Error boundaries must be Client Components — React catches a
// render/runtime error on the client and offers recovery. This is the catch-all: any route
// that throws and has no more-specific error.js (e.g. /employees/error.js) lands here
// instead of a white screen. `reset()` re-renders the failed segment.
export default function Error({ error, reset }) {
  const t = useT();
  return (
    <ErrorBox
      title={t("error.title")}
      message={error?.message ?? t("error.generic")}
      actionLabel={t("error.tryAgain")}
      onReset={reset}
    />
  );
}
