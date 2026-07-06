import { Readable } from "node:stream";
import { getViewer, withViewer } from "@hris/auth";
import { verifyDownload } from "@/lib/sign";
import { storage } from "@/lib/storage";

// Authorized file download. Three gates: a valid session (proxy-protected route), a valid
// short-lived signature bound to this doc + user, and RLS (the real authority — a valid
// signature for a document you can't see still 404s).
export async function GET(request, { params }) {
  const { id } = await params;

  const viewer = await getViewer();
  if (!viewer) return new Response("Unauthorized", { status: 401 });

  const { searchParams } = new URL(request.url);
  if (!verifyDownload(id, viewer.userId, searchParams.get("exp"), searchParams.get("sig"))) {
    return new Response("Invalid or expired link", { status: 403 });
  }

  const doc = await withViewer(viewer, (tx) =>
    tx.employeeDocument.findUnique({ where: { id }, select: { fileUrl: true, fileName: true } }),
  );
  if (!doc) return new Response("Not found", { status: 404 });

  const nodeStream = await storage.getStream(doc.fileUrl);
  return new Response(Readable.toWeb(nodeStream), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${doc.fileName.replace(/"/g, "")}"`,
    },
  });
}
