import { getViewer, canEditEmployee } from "@hris/auth";
import { getEmployeeDocuments } from "@/lib/documents";
import { humanize, formatDate } from "@/lib/format";
import { Card } from "@/components/profile-ui";
import { UploadDocForm } from "@/components/UploadDocForm";
import { DeleteDocButton } from "@/components/DeleteDocButton";

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// Documents tab. The list is RLS-scoped; upload/delete are HR-only. If the employee isn't
// visible at all, the profile layout already 404s before this renders.
export default async function EmployeeDocumentsPage({ params }) {
  const { id } = await params;
  const [documents, viewer] = await Promise.all([getEmployeeDocuments(id), getViewer()]);
  const canEdit = viewer ? canEditEmployee(viewer) : false;

  return (
    <Card title={`Documents (${documents.length})`}>
      {documents.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No documents.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {documents.map((d) => (
            <li key={d.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <div className="min-w-0">
                <a href={d.downloadUrl} className="font-medium text-blue-600 hover:underline dark:text-blue-400">
                  {d.fileName}
                </a>
                <span className="ml-2 text-xs text-zinc-400">
                  {humanize(d.documentType)} · {formatBytes(d.fileSizeBytes)} · {formatDate(d.createdAt)} · {d.uploadedByName}
                  {d.expiresAt ? ` · expires ${formatDate(d.expiresAt)}` : ""}
                </span>
              </div>
              {canEdit && <DeleteDocButton docId={d.id} />}
            </li>
          ))}
        </ul>
      )}
      {canEdit && <UploadDocForm employeeId={id} />}
    </Card>
  );
}
