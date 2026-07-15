"use client";

import { useActionState } from "react";
import { deleteDepartment } from "@/app/departments/actions";
import { useT } from "./LocaleProvider";

export function DeleteDepartmentButton({ departmentId }) {
  const t = useT();
  const [state, formAction, pending] = useActionState(deleteDepartment.bind(null, departmentId), {});

  return (
    <form action={formAction} className="inline">
      <button
        type="submit"
        disabled={pending}
        title={state?.error ?? t("dept.deleteTitle")}
        className="rounded-md border border-destructive/40 px-2.5 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50   "
      >
        {pending ? "…" : t("dept.delete")}
      </button>
      {state?.error && <span className="ml-2 text-xs text-destructive ">{state.error}</span>}
    </form>
  );
}
