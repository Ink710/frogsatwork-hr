"use client";

import { useT, ErrorBox } from "@hris/ui/client";

// App-wide error boundary. Error boundaries must be Client Components — React catches a
// render/runtime error on the client and offers recovery. This is the catch-all: any route that
// throws and has no more-specific error.js lands here instead of a white screen. `reset()`
// re-renders the failed segment.
// ⚠️ DIFFERS FROM THE OTHER THREE APPS ON PURPOSE: it never shows `error.message`.
//
// There, the audience is a signed-in colleague and a real message helps them tell you what broke.
// Every visitor here is an anonymous stranger, so the message is always the generic one — an error
// string is the kind of thing that names a table, a constraint or a driver, and this app's whole
// posture is that a stranger learns nothing about the system behind it. The cause is still LOGGED
// server-side, which is the half that actually helps debugging (the lesson from the outage where
// three tidy catch blocks left the platform logs empty).
export default function Error({ error, reset }) {
  const t = useT();
  console.error("[candidate-portal] render error", error);
  return (
    <ErrorBox
      title={t("error.title")}
      message={t("error.generic")}
      actionLabel={t("error.tryAgain")}
      onReset={reset}
    />
  );
}
