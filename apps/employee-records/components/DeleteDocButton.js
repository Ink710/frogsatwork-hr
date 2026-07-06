"use client";

import { useActionState } from "react";
import { deleteDocument } from "@/app/employees/[id]/actions";

export function DeleteDocButton({ docId }) {
  const action = deleteDocument.bind(null, docId);
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction}>
      <button
        type="submit"
        disabled={pending}
        className="text-xs text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
        title={state?.error ?? "Delete document"}
      >
        {pending ? "…" : "Delete"}
      </button>
    </form>
  );
}
