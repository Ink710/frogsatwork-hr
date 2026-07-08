import { humanize, formatDate, formatMoney, formatPayBasis } from "@/lib/format";

// Presentational, server-rendered (no "use client" — it has no interactivity).
// Renders the effective-dated history as a vertical timeline, newest at the top.
// `history` is expected already ordered version-desc.
export function HistoryTimeline({ history }) {
  if (!history || history.length === 0) {
    return (
      <p className="text-sm text-zinc-500">No recorded history.</p>
    );
  }

  return (
    <ol className="relative border-l border-zinc-200 dark:border-zinc-800">
      {history.map((h) => {
        const isCurrent = h.effectiveTo === null;
        const from = formatDate(h.effectiveFrom);
        const to = formatDate(h.effectiveTo); // null => ongoing
        const changed = Array.isArray(h.changedFields) ? h.changedFields : [];

        return (
          <li key={h.id} className="mb-8 ml-6">
            {/* dot */}
            <span
              className={`absolute -left-[7px] mt-1.5 h-3.5 w-3.5 rounded-full border-2 border-white dark:border-zinc-950 ${
                isCurrent ? "bg-green-500" : "bg-zinc-300 dark:bg-zinc-600"
              }`}
            />
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold">{h.jobTitle}</h3>
              {isCurrent && (
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/40 dark:text-green-300">
                  Current
                </span>
              )}
              <span className="text-xs text-zinc-400">v{h.version}</span>
            </div>

            <p className="mt-0.5 text-sm text-zinc-500">
              {from} — {to ?? "Present"}
            </p>

            <dl className="mt-2 grid grid-cols-1 gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
              <div className="flex gap-2">
                <dt className="text-zinc-400">Type</dt>
                <dd>{humanize(h.employmentType)}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-zinc-400">Department</dt>
                <dd>{h.departmentSnapshot}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-zinc-400">Manager</dt>
                <dd>{h.managerSnapshot ?? "—"}</dd>
              </div>
              {h.flsaClassification && (
                <div className="flex gap-2">
                  <dt className="text-zinc-400">FLSA</dt>
                  <dd>{humanize(h.flsaClassification)}</dd>
                </div>
              )}
              {h.payFrequency && (
                <div className="flex gap-2">
                  <dt className="text-zinc-400">Pay frequency</dt>
                  <dd>{humanize(h.payFrequency)}</dd>
                </div>
              )}
              {h.salary != null && (
                <div className="flex gap-2">
                  <dt className="text-zinc-400">Salary</dt>
                  <dd className="font-medium">
                    {formatMoney(h.salary, h.currency)}
                    {formatPayBasis(h.payBasis)}
                  </dd>
                </div>
              )}
              {h.changeReason && (
                <div className="flex gap-2">
                  <dt className="text-zinc-400">Reason</dt>
                  <dd>{h.changeReason}</dd>
                </div>
              )}
            </dl>

            {changed.length > 0 && changed[0] !== "initial" && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {changed.map((field) => (
                  <span
                    key={field}
                    className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                  >
                    {humanize(field)}
                  </span>
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
