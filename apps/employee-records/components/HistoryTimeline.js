import { formatDate, formatMoney, formatPayBasis } from "@/lib/format";

// Presentational, server-rendered (no "use client"). Renders the effective-dated history as a
// vertical timeline, newest at the top. `history` is expected already ordered version-desc.
// `t` (translator) and `locale` (BCP-47) are passed by the server page so it stays sync/pure.
// changedFields uses DB column names; map the ones whose field.* key differs.
const CHANGED_FIELD_KEY = {
  flsaClassification: "field.flsa",
  departmentId: "field.department",
  managerId: "field.manager",
};

export function HistoryTimeline({ history, t, locale = "en-US" }) {
  if (!history || history.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("history.noHistory")}</p>;
  }

  const te = (kind, val) => (val ? t(`enum.${kind}.${val}`) : "—");

  return (
    <ol className="relative border-l border-border">
      {history.map((h) => {
        const isCurrent = h.effectiveTo === null;
        const from = formatDate(h.effectiveFrom, locale);
        const to = formatDate(h.effectiveTo, locale); // null => ongoing
        const changed = Array.isArray(h.changedFields) ? h.changedFields : [];

        return (
          <li key={h.id} className="mb-8 ml-6">
            <span
              className={`absolute -left-[7px] mt-1.5 h-3.5 w-3.5 rounded-full border-2 border-background ${
                isCurrent ? "bg-success/100" : "bg-border"
              }`}
            />
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold">{h.jobTitle}</h3>
              {isCurrent && (
                <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success  ">
                  {t("history.current")}
                </span>
              )}
              <span className="text-xs text-muted-foreground">v{h.version}</span>
            </div>

            <p className="mt-0.5 text-sm text-muted-foreground">
              {from} — {to ?? t("common.present")}
            </p>

            <dl className="mt-2 grid grid-cols-1 gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
              <div className="flex gap-2">
                <dt className="text-muted-foreground">{t("history.type")}</dt>
                <dd>{te("employmentType", h.employmentType)}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted-foreground">{t("profile.department")}</dt>
                <dd>{h.departmentSnapshot}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted-foreground">{t("history.manager")}</dt>
                <dd>{h.managerSnapshot ?? "—"}</dd>
              </div>
              {h.flsaClassification && (
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">{t("history.flsa")}</dt>
                  <dd>{te("flsa", h.flsaClassification)}</dd>
                </div>
              )}
              {h.payFrequency && (
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">{t("history.payFrequency")}</dt>
                  <dd>{te("payFrequency", h.payFrequency)}</dd>
                </div>
              )}
              {h.salary != null && (
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">{t("history.salary")}</dt>
                  <dd className="font-medium">
                    {formatMoney(h.salary, h.currency, locale)}
                    {formatPayBasis(h.payBasis)}
                  </dd>
                </div>
              )}
              {h.changeReason && (
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">{t("history.reason")}</dt>
                  <dd>{h.changeReason}</dd>
                </div>
              )}
            </dl>

            {changed.length > 0 && changed[0] !== "initial" && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {changed.map((f) => (
                  <span
                    key={f}
                    className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground  dark:text-muted-foreground/50"
                  >
                    {t(CHANGED_FIELD_KEY[f] ?? `field.${f}`)}
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
