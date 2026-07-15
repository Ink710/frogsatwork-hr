import { getViewer, canEditEmployee } from "@hris/auth";
import { getEmployeeDocuments } from "@/lib/documents";
import { getT, getLocale } from "@/lib/i18n.server";
import { INTL_LOCALE } from "@/lib/i18n";
import { formatDate } from "@/lib/format";
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
  const [documents, viewer, t, localeCode] = await Promise.all([
    getEmployeeDocuments(id),
    getViewer(),
    getT(),
    getLocale(),
  ]);
  const locale = INTL_LOCALE[localeCode];
  const canEdit = viewer ? canEditEmployee(viewer) : false;

  return (
    <Card title={t("documents.title", { count: documents.length })}>
      {documents.length === 0 ? (
        <p className="text-sm text-muted-foreground dark:text-muted-foreground">{t("documents.none")}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border  ">
          {documents.map((d) => (
            <li key={d.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <div className="min-w-0">
                <a href={d.downloadUrl} className="font-medium text-primary hover:underline ">
                  {d.fileName}
                </a>
                <span className="ml-2 text-xs text-muted-foreground">
                  {t(`enum.documentType.${d.documentType}`)} · {formatBytes(d.fileSizeBytes)} · {formatDate(d.createdAt, locale)} · {d.uploadedByName}
                  {d.expiresAt ? ` · ${t("documents.expires", { date: formatDate(d.expiresAt, locale) })}` : ""}
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
