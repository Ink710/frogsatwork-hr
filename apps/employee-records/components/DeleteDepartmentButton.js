"use client";

import { useActionState } from "react";
import { deleteDepartment } from "@/app/departments/actions";

export function DeleteDepartmentButton({ departmentId }) {
  const [state, formAction, pending] = useActionState(deleteDepartment.bind(null, departmentId), {});

  return (
    <form action={formAction} className="inline">
      <button
        type="submit"
        disabled={pending}
        title={state?.error ?? "Delete department"}
        className="rounded-md border border-red-300 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/30"
      >
        {pending ? "…" : "Delete"}
      </button>
      {state?.error && <span className="ml-2 text-xs text-red-600 dark:text-red-400">{state.error}</span>}
    </form>
  );
}
