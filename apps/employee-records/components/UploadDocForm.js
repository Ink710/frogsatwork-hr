"use client";

import { useActionState } from "react";
import { uploadDocument } from "@/app/employees/[id]/actions";
import { DOCUMENT_TYPES } from "@hris/types";
import { useT } from "./LocaleProvider";

export function UploadDocForm({ employeeId }) {
  const t = useT();
  const action = uploadDocument.bind(null, employeeId);
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-dashed border-border p-3 ">
      {state?.error && <p className="w-full text-sm text-destructive ">{state.error}</p>}
      {state?.ok && <p className="w-full text-sm text-success ">{t("documents.uploaded")}</p>}
      <div>
        <label className="block text-xs text-muted-foreground" htmlFor="documentType">{t("documents.type")}</label>
        <select id="documentType" name="documentType" className="mt-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:border-ring">
          {DOCUMENT_TYPES.map((v) => <option key={v} value={v}>{t(`enum.documentType.${v}`)}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs text-muted-foreground" htmlFor="expiresAt">{t("documents.expiresAt")}</label>
        <input id="expiresAt" name="expiresAt" type="date" className="mt-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:border-ring" />
      </div>
      <div>
        <label className="block text-xs text-muted-foreground" htmlFor="file">{t("documents.file")}</label>
        <input id="file" name="file" type="file" required className="mt-1 text-sm" />
      </div>
      <button type="submit" disabled={pending} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
        {pending ? t("documents.uploading") : t("documents.upload")}
      </button>
    </form>
  );
}
