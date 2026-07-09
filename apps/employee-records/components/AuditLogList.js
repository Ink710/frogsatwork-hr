"use client";

import { useState, useTransition } from "react";
import { loadMoreAuditLog } from "@/app/employees/[id]/actions";
import { formatDateTime, REDACTED } from "@/lib/format";
import { INTL_LOCALE } from "@/lib/i18n";
import { useT, useLocale } from "./LocaleProvider";

const EVENT_STYLES = {
  CREATE: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  REHIRE: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  UPDATE: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  CORRECTION: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  LEAVE: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  REINSTATE: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  TERMINATE: "bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-300",
  SUSPEND: "bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-300",
  PERMISSION_DENIED: "bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-300",
  LOGIN_FAILED: "bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-300",
  VIEW: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  EXPORT: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

// beforeState/afterState keys are camelCase field names ("jobTitle"); prettify by splitting on
// capitals. (These are raw audit-payload keys, kept neutral rather than fully localized.)
function labelize(key) {
  const words = key.replace(/([A-Z])/g, " $1").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function DiffValue({ value, t }) {
  if (value === REDACTED) {
    return (
      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">
        {t("audit.hiddenValue")}
      </span>
    );
  }
  if (value === null || value === undefined || value === "") {
    return <span className="text-zinc-400">—</span>;
  }
  return <span>{String(value)}</span>;
}

// Field-by-field before → after view of the event's JSON payload. The stored values are
// rendered verbatim (ids stay ids) — an audit trail shows what was written, not a prettied
// interpretation of it.
function Diff({ before, after, t }) {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  if (keys.length === 0) return null;
  return (
    <dl className="mt-2 space-y-1 border-l-2 border-zinc-100 pl-3 dark:border-zinc-800">
      {keys.map((k) => (
        <div key={k} className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
          <dt className="text-zinc-500">{labelize(k)}:</dt>
          <dd className="flex flex-wrap items-baseline gap-x-1.5">
            {before && k in before && (
              <>
                <DiffValue value={before[k]} t={t} />
                <span className="text-zinc-400">→</span>
              </>
            )}
            <DiffValue value={after?.[k]} t={t} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function AuditLogList({ employeeId, initialEvents, initialCursor }) {
  const t = useT();
  const locale = INTL_LOCALE[useLocale()];
  const [events, setEvents] = useState(initialEvents);
  const [cursor, setCursor] = useState(initialCursor);
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  function loadMore() {
    setError(null);
    startTransition(async () => {
      const res = await loadMoreAuditLog(employeeId, cursor);
      if (res.error) {
        setError(res.error);
        return;
      }
      setEvents((prev) => [...prev, ...res.events]);
      setCursor(res.nextCursor);
    });
  }

  return (
    <div>
      <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {events.map((e) => (
          <li key={e.id} className="px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                    EVENT_STYLES[e.eventType] ?? EVENT_STYLES.VIEW
                  }`}
                >
                  {t(`enum.auditEvent.${e.eventType}`)}
                </span>
                <span className="text-sm">
                  {t(`audit.summary.${e.eventType}`)}
                </span>
                <span className="text-sm text-zinc-500">
                  {t("common.by", { name: e.actorName })}
                  {e.actorType !== "USER" && ` (${t(`enum.actorType.${e.actorType}`)})`}
                </span>
              </div>
              {/* The server renders this in its timezone, the browser in the user's —
                  suppress the (expected) hydration diff instead of crashing on it. */}
              <time className="text-xs text-zinc-400" suppressHydrationWarning>
                {formatDateTime(e.occurredAt, locale)}
              </time>
            </div>
            <Diff before={e.beforeState} after={e.afterState} t={t} />
          </li>
        ))}
      </ul>

      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {cursor && (
        <button
          type="button"
          onClick={loadMore}
          disabled={pending}
          className="mt-4 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          {pending ? t("audit.loading") : t("audit.loadMore")}
        </button>
      )}
    </div>
  );
}
