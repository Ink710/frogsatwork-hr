"use client";

import { useActionState } from "react";
import { useT } from "@/components/LocaleProvider";
import { createProject, updateProject } from "@/app/projects/actions";

const field =
  "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30";

// Create (no project) or rename (project passed) a project. Managers/HR only; the server re-checks.
export function ProjectForm({ project }) {
  const t = useT();
  const action = project ? updateProject.bind(null, project.id) : createProject;
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
        <div>
          <label htmlFor="name" className="block text-sm font-medium">{t("projects.form.name")}</label>
          <input id="name" name="name" defaultValue={project?.name ?? ""} required maxLength={120} className={field} />
        </div>
        <div>
          <label htmlFor="code" className="block text-sm font-medium">{t("projects.form.code")}</label>
          <input id="code" name="code" defaultValue={project?.code ?? ""} maxLength={16} placeholder="PLAT" className={`${field} font-mono`} />
        </div>
      </div>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
      >
        {project ? t("projects.form.save") : t("projects.form.create")}
      </button>
    </form>
  );
}
