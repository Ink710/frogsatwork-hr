"use client";

import { useActionState } from "react";
import { X } from "lucide-react";
import { useT } from "@/components/LocaleProvider";
import { assignToProject, unassignFromProject } from "@/app/projects/actions";

// Manage who may log time to a project: a list of current assignees (each removable) + a picker of
// assignable employees (the viewer's RLS-scoped active employees, minus those already on). Managers/HR
// only; the server re-checks ownership + that the target is in scope.
export function AssignmentEditor({ projectId, assignees, candidates }) {
  const t = useT();
  const [addState, addAction, addPending] = useActionState(assignToProject.bind(null, projectId), undefined);

  return (
    <div className="space-y-4">
      {assignees.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("projects.noAssignees")}</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {assignees.map((a) => (
            <li key={a.assignmentId} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="text-sm font-medium">
                {a.name} <span className="font-mono text-xs text-muted-foreground">({a.employeeNumber})</span>
              </span>
              <form action={unassignFromProject.bind(null, projectId, a.assignmentId)}>
                <button
                  type="submit"
                  aria-label={t("projects.remove")}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-destructive"
                >
                  <X className="h-3.5 w-3.5" /> {t("projects.remove")}
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      {candidates.length > 0 ? (
        <form action={addAction} className="flex flex-wrap items-end gap-3">
          <div className="min-w-[16rem] flex-1">
            <label htmlFor="employeeId" className="block text-sm font-medium">{t("projects.addAssignee")}</label>
            <select
              id="employeeId"
              name="employeeId"
              required
              defaultValue=""
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
            >
              <option value="" disabled>{t("projects.selectEmployee")}</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({c.employeeNumber})</option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={addPending}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {t("projects.add")}
          </button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">{t("projects.noCandidates")}</p>
      )}
      {addState?.error && <p className="text-sm text-destructive">{addState.error}</p>}
    </div>
  );
}
