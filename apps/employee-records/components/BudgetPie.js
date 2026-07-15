import { formatMoney } from "@/lib/format";

// Brand categorical palette (theme-aware CSS vars registered by @theme in globals.css). Cycles
// if there are more departments than colors.
const PALETTE = [
  "var(--color-primary)",
  "var(--color-aqua)",
  "var(--color-info)",
  "var(--color-yellow)",
  "var(--color-success)",
  "var(--color-secondary)",
];

const R = 70;
const CIRCUMFERENCE = 2 * Math.PI * R;

// Prefix-sum the slice lengths into { color, dash, offset, pct } segments. A plain module
// function so the running total isn't a mutation inside component render.
function toSegments(data, total) {
  let offset = 0;
  return data.map((d, i) => {
    const value = Number(d.budget);
    const dash = (value / total) * CIRCUMFERENCE;
    const seg = { color: PALETTE[i % PALETTE.length], dash, offset, pct: (value / total) * 100, name: d.name, budget: d.budget };
    offset += dash;
    return seg;
  });
}

// Dependency-free SVG donut of department budgets + a legend (name · amount · %). Pure/server-
// rendered. Budgets are stored without a currency, so we format as USD. `data` = [{name, budget}].
export function BudgetPie({ data, locale = "en-US", t }) {
  const total = data.reduce((sum, d) => sum + Number(d.budget), 0);
  if (total <= 0) return <p className="text-sm text-muted-foreground">{t("dash.noData")}</p>;

  const r = R;
  const C = CIRCUMFERENCE;
  const segments = toSegments(data, total);

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row">
      {/* -rotate-90 starts the first slice at 12 o'clock; each ring segment is offset by the
          cumulative length of the ones before it. */}
      <svg viewBox="0 0 200 200" className="h-40 w-40 shrink-0 -rotate-90" role="img" aria-label={t("dash.budgets")}>
        <circle cx="100" cy="100" r={r} fill="none" stroke="var(--color-muted)" strokeWidth="26" />
        {segments.map((s, i) => (
          <circle
            key={i}
            cx="100"
            cy="100"
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth="26"
            strokeDasharray={`${s.dash} ${C - s.dash}`}
            strokeDashoffset={-s.offset}
          />
        ))}
      </svg>

      <ul className="w-full space-y-2 text-sm">
        {segments.map((s, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: s.color }} aria-hidden="true" />
            <span className="flex-1 truncate text-muted-foreground">{s.name}</span>
            <span className="font-mono font-medium tabular-nums">{formatMoney(s.budget, "USD", locale)}</span>
            <span className="w-10 shrink-0 text-right text-xs text-muted-foreground">{s.pct.toFixed(0)}%</span>
          </li>
        ))}
        <li className="flex items-center gap-2 border-t border-border pt-2 font-medium">
          <span className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="flex-1">{t("dash.budgetTotal")}</span>
          <span className="font-mono tabular-nums">{formatMoney(total, "USD", locale)}</span>
          <span className="w-10 shrink-0" />
        </li>
      </ul>
    </div>
  );
}
