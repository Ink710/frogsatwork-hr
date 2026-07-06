"use client";

import { useActionState } from "react";
import { uploadDocument } from "@/app/employees/[id]/actions";

const TYPES = [
  ["CONTRACT", "Contract"],
  ["IDENTIFICATION", "Identification"],
  ["CERTIFICATION", "Certification"],
  ["PERFORMANCE", "Performance"],
  ["OTHER", "Other"],
];

export function UploadDocForm({ employeeId }) {
  const action = uploadDocument.bind(null, employeeId);
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
      {state?.error && <p className="w-full text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      {state?.ok && <p className="w-full text-sm text-green-600 dark:text-green-400">Uploaded.</p>}
      <div>
        <label className="block text-xs text-zinc-500" htmlFor="documentType">Type</label>
        <select id="documentType" name="documentType" className="mt-1 rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900">
          {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs text-zinc-500" htmlFor="expiresAt">Expires (optional)</label>
        <input id="expiresAt" name="expiresAt" type="date" className="mt-1 rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
      </div>
      <div>
        <label className="block text-xs text-zinc-500" htmlFor="file">File</label>
        <input id="file" name="file" type="file" required className="mt-1 text-sm" />
      </div>
      <button type="submit" disabled={pending} className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50">
        {pending ? "Uploading…" : "Upload"}
      </button>
    </form>
  );
}
