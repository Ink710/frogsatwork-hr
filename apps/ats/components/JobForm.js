"use client";

import { useActionState } from "react";
import { useT } from "@hris/ui/client";
import { EEO_JOB_CATEGORIES } from "@hris/recruiting";
import { createJob, updateJob } from "@/app/(internal)/jobs/actions";

const INPUT =
  "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";

// Shared by "open a requisition" and the manage screen's Details card. `job` is null when creating.
// The two actions have different signatures (create takes no id), so the caller's mode picks one.
export function JobForm({ job = null, departments = [], employmentTypes = [] }) {
  const t = useT();
  const editing = Boolean(job);
  const action = editing ? updateJob.bind(null, job.id) : createJob;
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div>
        <label className="block text-sm font-medium" htmlFor="title">
          {t("jobForm.title")}
        </label>
        <input id="title" name="title" required defaultValue={job?.title ?? ""} className={INPUT} />
      </div>

      <div>
        <label className="block text-sm font-medium" htmlFor="description">
          {t("jobForm.description")}
        </label>
        <textarea id="description" name="description" rows={4} defaultValue={job?.description ?? ""} className={INPUT} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium" htmlFor="location">
            {t("jobForm.location")}
          </label>
          <input id="location" name="location" defaultValue={job?.location ?? ""} className={INPUT} />
        </div>
        <div>
          <label className="block text-sm font-medium" htmlFor="openings">
            {t("jobForm.openings")}
          </label>
          <input
            id="openings"
            name="openings"
            type="number"
            min="1"
            required
            defaultValue={job?.openings ?? 1}
            className={INPUT}
          />
        </div>
        <div>
          <label className="block text-sm font-medium" htmlFor="employmentType">
            {t("jobForm.employmentType")}
          </label>
          <select id="employmentType" name="employmentType" defaultValue={job?.employmentType ?? "FULL_TIME"} className={INPUT}>
            {employmentTypes.map((et) => (
              <option key={et} value={et}>
                {t(`enum.employmentType.${et}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium" htmlFor="departmentId">
            {t("jobForm.department")}
          </label>
          <select id="departmentId" name="departmentId" defaultValue={job?.departmentId ?? ""} className={INPUT}>
            <option value="">{t("jobForm.noDepartment")}</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        {/* EEO-1 job category (M12). Starts UNSET and is never defaulted — a guessed category
            produces a misfiled regulatory return, so the filing export reports the gap instead. */}
        <div>
          <label className="block text-sm font-medium" htmlFor="eeoJobCategory">
            {t("jobForm.eeoJobCategory")}
          </label>
          <select
            id="eeoJobCategory"
            name="eeoJobCategory"
            defaultValue={job?.eeoJobCategory ?? ""}
            className={INPUT}
          >
            <option value="">{t("jobForm.noEeoJobCategory")}</option>
            {EEO_JOB_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`enum.eeoJobCategory.${c}`)}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">{t("jobForm.eeoJobCategoryHint")}</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {editing ? t("jobForm.save") : t("jobForm.create")}
        </button>
        {state?.ok && <span className="text-xs text-success">{t("jobForm.saved")}</span>}
        {state?.error && <span className="text-xs text-destructive">{state.error}</span>}
      </div>
    </form>
  );
}
