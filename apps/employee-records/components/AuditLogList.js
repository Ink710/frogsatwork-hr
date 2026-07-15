"use client";

import { useState, useTransition } from "react";
import { loadMoreAuditLog } from "@/app/employees/[id]/actions";
import { formatDateTime, REDACTED } from "@/lib/format";
import { INTL_LOCALE } from "@/lib/i18n";
import { useT, useLocale } from "./LocaleProvider";

const EVENT_STYLES = {
  CREATE: "bg-success/15 text-success  ",
  REHIRE: "bg-success/15 text-success  ",
  UPDATE: "bg-primary/15 text-primary  ",
  CORRECTION: "bg-warning/15 text-warning  ",
  LEAVE: "bg-warning/15 text-warning  ",
  REINSTATE: "bg-success/15 text-success  ",
  TERMINATE: "bg-destructive/15 text-destructive  ",
  SUSPEND: "bg-destructive/15 text-destructive  ",
  PERMISSION_DENIED: "bg-destructive/15 text-destructive  ",
  LOGIN_FAILED: "bg-destructive/15 text-destructive  ",
  VIEW: "bg-muted text-muted-foreground  dark:text-muted-foreground",
  EXPORT: "bg-muted text-muted-foreground  dark:text-muted-foreground",
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
      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground ">
        {t("audit.hiddenValue")}
      </span>
    );
  }
  if (value === null || value === undefined || value === "") {
    return <span className="text-muted-foreground">—</span>;
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
    <dl className="mt-2 space-y-1 border-l-2 border-border pl-3 ">
      {keys.map((k) => (
        <div key={k} className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
          <dt className="text-muted-foreground">{labelize(k)}:</dt>
          <dd className="flex flex-wrap items-baseline gap-x-1.5">
            {before && k in before && (
              <>
                <DiffValue value={before[k]} t={t} />
                <span className="text-muted-foreground">→</span>
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
      <ul className="divide-y divide-border rounded-lg border border-border  ">
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
                <span className="text-sm text-muted-foreground">
                  {t("common.by", { name: e.actorName })}
                  {e.actorType !== "USER" && ` (${t(`enum.actorType.${e.actorType}`)})`}
                </span>
              </div>
              {/* The server renders this in its timezone, the browser in the user's —
                  suppress the (expected) hydration diff instead of crashing on it. */}
              <time className="text-xs text-muted-foreground" suppressHydrationWarning>
                {formatDateTime(e.occurredAt, locale)}
              </time>
            </div>
            <Diff before={e.beforeState} after={e.afterState} t={t} />
          </li>
        ))}
      </ul>

      {error && <p className="mt-3 text-sm text-destructive ">{error}</p>}

      {cursor && (
        <button
          type="button"
          onClick={loadMore}
          disabled={pending}
          className="mt-4 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50  "
        >
          {pending ? t("audit.loading") : t("audit.loadMore")}
        </button>
      )}
    </div>
  );
}
