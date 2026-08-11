import { summaryCsv, filingCsv, EEO_MIN_CELL } from "@hris/recruiting";
import {
  getEeoSummary,
  getEeoFiling,
  canReadEeo,
  recordEeoExport,
} from "@/lib/queries";

// The EEO export endpoint. Two artifacts behind one route, distinguished by ?variant=:
//
//   summary — the on-screen report as CSV, SUPPRESSED. HR_ADMIN + HR_GENERALIST.
//   filing  — the EEO-1 cross-tab, EXACT. HR_ADMIN only, and recorded every time.
//
// ⚠️ NOTE WHAT ISN'T HERE: any auth code of its own beyond the role checks. Unlike the retention
// cron, this route is deliberately NOT excluded from proxy.js's matcher, so the proxy has already
// required a valid session before this function runs. Two endpoints, two auth models — a shared
// secret for the unattended one, a session for the human one — and the matcher is where that
// difference is expressed. The role gates below (and the DB functions behind them) do the rest.
export const dynamic = "force-dynamic";

function csvResponse(body, filename) {
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      // An export of demographic data should never sit in a shared cache.
      "cache-control": "no-store",
    },
  });
}

const stamp = (d) => d.toISOString().slice(0, 10);

export async function GET(request) {
  const variant = new URL(request.url).searchParams.get("variant") === "filing" ? "FILING" : "SUMMARY";
  const generatedAt = new Date();

  if (variant === "FILING") {
    // getEeoFiling returns null when app_can_file_eeo() says no — refused, not empty.
    const filing = await getEeoFiling();
    if (!filing) return Response.json({ error: "forbidden" }, { status: 403 });

    const body = filingCsv(filing.rows, { generatedAt, uncategorisedJobs: filing.uncategorisedJobs });
    // Recorded AFTER the file is successfully built, so the log counts files that exist rather than
    // attempts that failed — but BEFORE the response is returned, so a download can't escape unlogged.
    await recordEeoExport({
      variant,
      rowCount: filing.rows.length,
      uncategorisedJobs: filing.uncategorisedJobs,
    });
    return csvResponse(body, `eeo1-filing-${stamp(generatedAt)}.csv`);
  }

  if (!(await canReadEeo())) return Response.json({ error: "forbidden" }, { status: 403 });
  const summary = await getEeoSummary();
  if (!summary) return Response.json({ error: "forbidden" }, { status: 403 });

  const body = summaryCsv(summary.dimensions, { generatedAt, minCell: EEO_MIN_CELL });
  const rowCount = summary.dimensions.reduce((n, d) => n + d.cells.length, 0);
  // The suppressed variant is logged too. It reveals nothing exact, but a complete trail is easier
  // to reason about than one with a documented gap in it.
  await recordEeoExport({ variant, rowCount });
  return csvResponse(body, `eeo-summary-${stamp(generatedAt)}.csv`);
}
