import { Readable } from "node:stream";
import { getViewer, withViewer } from "@hris/auth";
import { createStorage } from "@hris/storage";
import { verifyApplicationResumeDownload } from "@/lib/sign";

const storage = createStorage();

/**
 * Download the CV a specific application was submitted with (M7).
 *
 * The sibling of `/api/candidates/[id]/resume`, and the two are deliberately both here: that one
 * serves the CV we currently hold for a person, this one serves the document that was actually
 * reviewed. Before M7 they were the same file by definition — a résumé could not be replaced. Now
 * that an applicant manages their own, a recruiter reading a March application would otherwise be
 * handed August's file, with a scorecard beside it about a document nobody can produce any more.
 *
 * THREE GATES, unchanged in shape from the candidate route:
 *   1. a session — this route sits inside proxy.js's matcher, so anonymous callers never reach it;
 *   2. a valid short-lived signature bound to this APPLICATION and this user;
 *   3. RLS — the real one. A perfectly signed link for an application the viewer may not see still
 *      404s, because the row simply is not visible to them.
 */
export async function GET(request, { params }) {
  const { id } = await params;

  const viewer = await getViewer();
  if (!viewer) return new Response("Unauthorized", { status: 401 });

  const { searchParams } = new URL(request.url);
  if (
    !verifyApplicationResumeDownload(id, viewer.userId, searchParams.get("exp"), searchParams.get("sig"))
  ) {
    return new Response("Invalid or expired link", { status: 403 });
  }

  const application = await withViewer(viewer, (tx) =>
    tx.application.findUnique({ where: { id }, select: { resumeKey: true, resumeFileName: true } }),
  );

  // One 404 for three situations — hidden by RLS, submitted without a CV, or erased (which nulls
  // both columns). Collapsing them is deliberate: distinguishing them would turn this endpoint into
  // a way to probe which applications exist.
  if (!application?.resumeKey) return new Response("Not found", { status: 404 });

  let nodeStream;
  try {
    nodeStream = await storage.getStream(application.resumeKey);
  } catch (e) {
    console.error("[application-resume] storage read failed", {
      key: application.resumeKey,
      error: e,
    });
    return new Response("Résumé unavailable", { status: 404 });
  }

  return new Response(Readable.toWeb(nodeStream), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${(application.resumeFileName ?? "resume").replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
