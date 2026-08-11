// CSV rendering for the two EEO export artifacts (M12). Pure string work — no I/O, no Prisma, no
// access decisions. The route decides WHO may call these; this file only decides what the file
// looks like, which is exactly the kind of fiddly logic that deserves unit tests.
import type { EeoDimensionSummary } from "./eeo";

/**
 * Escape one CSV field.
 *
 * Quotes anything containing a comma, quote, or newline, and doubles embedded quotes — the RFC-4180
 * rules. Worth doing properly rather than reaching for `join(",")`: a job title like
 * `Engineer, Senior` would otherwise silently shift every column after it, and a corrupted
 * regulatory filing is a bad way to discover the bug.
 */
export function csvField(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function csvRow(fields: unknown[]): string {
  return fields.map(csvField).join(",");
}

/** Join rows with CRLF and end with one, per RFC 4180 — what spreadsheet software expects. */
export function csvDocument(rows: unknown[][]): string {
  return rows.map(csvRow).join("\r\n") + "\r\n";
}

export interface EeoFilingRow {
  jobCategory: string | null;
  gender: string;
  ethnicity: string;
  headcount: number;
}

/**
 * The SUPPRESSED export: the on-screen report, as a file.
 *
 * A withheld cell is written as the literal `SUPPRESSED`, never as a blank or a zero. A blank reads
 * as missing data and a zero is an outright lie; a word forces whoever opens the file to notice
 * that a rule was applied. The header carries the same warning the screen does.
 */
export function summaryCsv(
  dimensions: EeoDimensionSummary[],
  { generatedAt = new Date(), minCell }: { generatedAt?: Date; minCell: number },
): string {
  const rows: unknown[][] = [
    ["EEO self-identification summary"],
    ["Generated", generatedAt.toISOString()],
    [`Groups smaller than ${minCell} are withheld, plus one further group so a withheld figure cannot be derived by subtraction.`],
    [],
    ["Dimension", "Value", "Responses"],
  ];

  for (const d of dimensions) {
    for (const cell of d.cells) {
      rows.push([d.dimension, cell.value, cell.suppressed ? "SUPPRESSED" : cell.responses]);
    }
  }
  return csvDocument(rows);
}

/**
 * The FILING export: exact headcounts, pivoted into an EEO-1-shaped grid.
 *
 * Rows are job categories, columns are every (sex × race) combination present in the data. Exact
 * numbers, no suppression — a regulator is entitled to them, which is the whole reason this variant
 * is HR_ADMIN-only and audited.
 *
 * Requisitions with no job category appear as an explicit `UNCATEGORISED` row AND are called out in
 * a header warning. They are never dropped and never folded into a plausible-looking category: a
 * filing that silently omits people is worse than one that visibly has a gap to fix.
 */
export function filingCsv(
  rows: EeoFilingRow[],
  { generatedAt = new Date(), uncategorisedJobs = 0 }: { generatedAt?: Date; uncategorisedJobs?: number } = {},
): string {
  // Column order is derived from the data and sorted, so two exports of the same data are
  // byte-identical — which is what makes them diffable and worth archiving.
  const combos = [...new Set(rows.map((r) => `${r.gender}|${r.ethnicity}`))].sort();
  const categories = [...new Set(rows.map((r) => r.jobCategory ?? "UNCATEGORISED"))].sort();

  const counts = new Map<string, number>();
  for (const r of rows) {
    counts.set(`${r.jobCategory ?? "UNCATEGORISED"}|${r.gender}|${r.ethnicity}`, r.headcount);
  }

  const out: unknown[][] = [
    ["EEO-1 filing extract — EXACT COUNTS, NOT SUPPRESSED"],
    ["Generated", generatedAt.toISOString()],
    ["Confidential: for regulatory filing only. Do not circulate internally."],
  ];
  if (uncategorisedJobs > 0) {
    out.push([
      `WARNING: ${uncategorisedJobs} requisition(s) have no EEO-1 job category and appear as UNCATEGORISED.`,
    ]);
  }
  out.push([]);
  out.push(["Job category", ...combos.map((c) => c.replace("|", " / ")), "Total"]);

  for (const category of categories) {
    const cells = combos.map((c) => counts.get(`${category}|${c}`) ?? 0);
    out.push([category, ...cells, cells.reduce((a, b) => a + b, 0)]);
  }

  // A column-total row, because the first thing anyone does with a filing is check it adds up.
  const totals = combos.map((c) =>
    categories.reduce((sum, cat) => sum + (counts.get(`${cat}|${c}`) ?? 0), 0),
  );
  out.push(["Total", ...totals, totals.reduce((a, b) => a + b, 0)]);

  return csvDocument(out);
}
