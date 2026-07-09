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
    <form action={formAction} className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
      {state?.error && <p className="w-full text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      {state?.ok && <p className="w-full text-sm text-green-600 dark:text-green-400">{t("documents.uploaded")}</p>}
      <div>
        <label className="block text-xs text-zinc-500" htmlFor="documentType">{t("documents.type")}</label>
        <select id="documentType" name="documentType" className="mt-1 rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900">
          {DOCUMENT_TYPES.map((v) => <option key={v} value={v}>{t(`enum.documentType.${v}`)}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs text-zinc-500" htmlFor="expiresAt">{t("documents.expiresAt")}</label>
        <input id="expiresAt" name="expiresAt" type="date" className="mt-1 rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
      </div>
      <div>
        <label className="block text-xs text-zinc-500" htmlFor="file">{t("documents.file")}</label>
        <input id="file" name="file" type="file" required className="mt-1 text-sm" />
      </div>
      <button type="submit" disabled={pending} className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50">
        {pending ? t("documents.uploading") : t("documents.upload")}
      </button>
    </form>
  );
}
