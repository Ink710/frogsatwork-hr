"use client";

import { useActionState } from "react";
import { deleteDocument } from "@/app/employees/[id]/actions";
import { useT } from "./LocaleProvider";

export function DeleteDocButton({ docId }) {
  const t = useT();
  const action = deleteDocument.bind(null, docId);
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction}>
      <button
        type="submit"
        disabled={pending}
        className="text-xs text-destructive hover:underline disabled:opacity-50 "
        title={state?.error ?? t("documents.deleteTitle")}
      >
        {pending ? "…" : t("common.delete")}
      </button>
    </form>
  );
}
