import { getViewer, withViewer } from "@hris/auth";
import { signDownload } from "./sign.js";

// List an employee's documents (RLS-scoped: HR all, manager their reports, employee own).
// Each doc carries a freshly-signed, short-lived download URL.
export async function getEmployeeDocuments(id) {
  const viewer = await getViewer();
  if (!viewer) return [];

  const docs = await withViewer(viewer, (tx) =>
    tx.employeeDocument.findMany({
      where: { employeeId: id },
      select: {
        id: true,
        documentType: true,
        fileName: true,
        fileSizeBytes: true,
        createdAt: true,
        expiresAt: true,
        uploadedBy: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  );

  return docs.map((d) => ({
    ...d,
    uploadedByName: d.uploadedBy?.name ?? "—",
    downloadUrl: signDownload(d.id, viewer.userId),
  }));
}
