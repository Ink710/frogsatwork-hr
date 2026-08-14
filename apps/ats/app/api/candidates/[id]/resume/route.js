import { Readable } from "node:stream";
import { getViewer, withViewer } from "@hris/auth";
import { createStorage } from "@hris/storage";
import { verifyResumeDownload } from "@/lib/sign";

const storage = createStorage();

/**
 * Download a candidate's résumé.
 *
 * THREE GATES, in order of increasing authority:
 *   1. a session — this route is deliberately NOT in proxy.js's matcher exclusions, so the proxy
 *      turns away anonymous callers before the handler runs (the M12 reasoning that kept
 *      api/eeo-export inside the matcher while api/cron sits outside it, authenticating differently);
 *   2. a valid short-lived signature bound to this candidate AND this user;
 *   3. RLS — the real one. A perfectly signed link for a candidate the viewer may not see still 404s,
 *      because `app_can_see_candidate` simply returns no row.
 *
 * ⚠️ WHO CAN READ A CV, AND WHY IT IS DELIBERATELY WIDER THAN THE OFFER PANEL. RLS lets the whole
 * hiring team through, interviewers included — the exact opposite of M14, where the salary band and
 * offer are restricted to people who can MANAGE the req. The two are different kinds of document. A
 * band is a commercial position that would anchor a scoring decision; a résumé is the thing the
 * candidate submitted IN ORDER to be evaluated, and the interviewer is the person evaluating them.
 * Withholding it would make the interview worse while protecting nothing. So there is no app-layer
 * narrowing here on purpose — this comment is the record of that being a decision, not an omission.
 */
export async function GET(request, { params }) {
  const { id } = await params;

  const viewer = await getViewer();
  if (!viewer) return new Response("Unauthorized", { status: 401 });

  const { searchParams } = new URL(request.url);
  if (!verifyResumeDownload(id, viewer.userId, searchParams.get("exp"), searchParams.get("sig"))) {
    return new Response("Invalid or expired link", { status: 403 });
  }

  const candidate = await withViewer(viewer, (tx) =>
    tx.candidate.findUnique({ where: { id }, select: { resumeKey: true, resumeFileName: true } }),
  );

  // One 404 for three different situations — hidden by RLS, never uploaded a CV, or erased (which
  // nulls resumeKey). Collapsing them is deliberate: distinguishing "no résumé" from "not allowed"
  // would turn this endpoint into a way to probe which candidates exist.
  if (!candidate?.resumeKey) return new Response("Not found", { status: 404 });

  let nodeStream;
  try {
    nodeStream = await storage.getStream(candidate.resumeKey);
  } catch {
    // The DB row says there is a file and the storage layer disagrees — a real inconsistency (an
    // unconfigured cloud driver, or a local file removed by hand). Say so plainly rather than
    // letting it surface as an unhandled 500.
    return new Response("Résumé unavailable", { status: 404 });
  }

  return new Response(Readable.toWeb(nodeStream), {
    headers: {
      "Content-Type": "application/octet-stream",
      // The stored filename is display-only and has never been part of the storage path (the key is
      // a server-generated UUID) — the quote strip keeps it from breaking out of the header.
      "Content-Disposition": `attachment; filename="${(candidate.resumeFileName ?? "resume").replace(/"/g, "")}"`,
      // A CV is personal data, so nothing about it should be written to disk anywhere in between.
      // Without this, Vercel's default is `public, max-age=0, must-revalidate` — revalidated, but
      // still stored. `no-store` is Vercel's own guidance for PII served through a function.
      "Cache-Control": "private, no-store",
      // The bytes are attacker-supplied (a stranger's upload) and we always send them as a download;
      // don't let a browser sniff its way to executing one.
      "X-Content-Type-Options": "nosniff",
    },
  });
}
