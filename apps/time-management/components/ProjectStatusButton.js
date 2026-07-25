"use client";

import { useActionState } from "react";
import { useT } from "@/components/LocaleProvider";
import { toggleProjectStatus } from "@/app/projects/actions";

// Archive an ACTIVE project or reactivate an ARCHIVED one. Archived projects drop out of the employee
// picker but keep their historical time entries.
export function ProjectStatusButton({ projectId, status }) {
  const t = useT();
  const [state, action, pending] = useActionState(toggleProjectStatus.bind(null, projectId), undefined);
  const archiving = status === "ACTIVE";

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <button
        type="submit"
        disabled={pending}
        className={`rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-60 ${
          archiving ? "border-border hover:bg-muted" : "border-primary/40 text-primary hover:bg-primary/10"
        }`}
      >
        {archiving ? t("projects.archive") : t("projects.reactivate")}
      </button>
      {state?.error && <p className="text-xs text-destructive">{state.error}</p>}
    </form>
  );
}
