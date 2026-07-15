"use client";

import { useActionState } from "react";
import { correctDetails, correctMaterial } from "@/app/employees/[id]/actions";
import {
  EMPLOYMENT_TYPE_OPTIONS,
  FLSA_OPTIONS,
  PAY_FREQUENCY_OPTIONS,
  PAY_BASIS_OPTIONS,
} from "@/lib/enums";
import { useT } from "./LocaleProvider";

const field = "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";
const label = "block text-sm font-medium";
const toDateInput = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");

export function CorrectForms({ employeeId, employee, current, withinWindow, windowDays, departments, managerOptions, canEditComp }) {
  const t = useT();
  const detailsAction = correctDetails.bind(null, employeeId);
  const materialAction = correctMaterial.bind(null, employeeId);
  const [idState, idForm, idPending] = useActionState(detailsAction, {});
  const [mtState, mtForm, mtPending] = useActionState(materialAction, {});

  return (
    <div className="mt-6 space-y-10">
      {/* Details — current-state, always correctable */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("correct.details")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("correct.detailsHelp")}</p>
        <form action={idForm} className="mt-4 space-y-4">
          {idState?.error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive  ">{idState.error}</p>}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label} htmlFor="firstName">{t("field.firstName")}</label>
              <input id="firstName" name="firstName" defaultValue={employee.firstName} required className={field} />
            </div>
            <div>
              <label className={label} htmlFor="lastName">{t("field.lastName")}</label>
              <input id="lastName" name="lastName" defaultValue={employee.lastName} required className={field} />
            </div>
          </div>
          <div>
            <label className={label} htmlFor="email">{t("field.email")}</label>
            <input id="email" name="email" type="email" defaultValue={employee.email} required className={field} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label} htmlFor="phone">{t("field.phone")}</label>
              <input id="phone" name="phone" defaultValue={employee.phone ?? ""} className={field} />
            </div>
            <div>
              <label className={label} htmlFor="location">{t("field.location")}</label>
              <input id="location" name="location" defaultValue={employee.location ?? ""} placeholder="e.g. Austin, TX" className={field} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label} htmlFor="workSchedule">{t("field.workSchedule")}</label>
              <input id="workSchedule" name="workSchedule" defaultValue={employee.workSchedule ?? ""} placeholder="e.g. Mon–Fri, 09:00–18:00" className={field} />
            </div>
            <div>
              <label className={label} htmlFor="timeZone">{t("field.timeZone")}</label>
              <input id="timeZone" name="timeZone" defaultValue={employee.timeZone ?? ""} placeholder="e.g. America/Chicago" className={field} />
            </div>
          </div>

          {canEditComp && (
            <div className="grid grid-cols-2 gap-4 rounded-md border border-border p-4 ">
              <p className="col-span-2 text-xs font-medium text-muted-foreground">{t("correct.compDetails")}</p>
              <div>
                <label className={label} htmlFor="lastReviewDate">{t("field.lastReview")}</label>
                <input id="lastReviewDate" name="lastReviewDate" type="date" defaultValue={toDateInput(employee.lastReviewDate)} className={field} />
              </div>
              <div>
                <label className={label} htmlFor="nextReviewDate">{t("field.nextReview")}</label>
                <input id="nextReviewDate" name="nextReviewDate" type="date" defaultValue={toDateInput(employee.nextReviewDate)} className={field} />
              </div>
              <div className="col-span-2">
                <label className={label} htmlFor="equityNote">{t("field.equity")}</label>
                <input id="equityNote" name="equityNote" defaultValue={employee.equityNote ?? ""} placeholder="e.g. 4-yr cliff · yr 1" className={field} />
              </div>
            </div>
          )}

          <button type="submit" disabled={idPending} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {idPending ? t("common.saving") : t("correct.saveDetails")}
          </button>
        </form>
      </section>

      {/* Material — only within the grace window */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("correct.material")}</h2>
        {withinWindow ? (
          <>
            <p className="mt-1 text-xs text-muted-foreground">{t("correct.materialHelp", { days: windowDays })}</p>
            <form action={mtForm} className="mt-4 space-y-4">
              {mtState?.error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive  ">{mtState.error}</p>}
              <div>
                <label className={label} htmlFor="jobTitle">{t("field.jobTitle")}</label>
                <input id="jobTitle" name="jobTitle" defaultValue={current?.jobTitle ?? ""} className={field} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={label} htmlFor="employmentType">{t("field.employmentType")}</label>
                  <select id="employmentType" name="employmentType" defaultValue={current?.employmentType ?? "FULL_TIME"} className={field}>
                    {EMPLOYMENT_TYPE_OPTIONS.map(([v]) => <option key={v} value={v}>{t(`enum.employmentType.${v}`)}</option>)}
                  </select>
                </div>
                <div>
                  <label className={label} htmlFor="flsaClassification">{t("field.flsa")}</label>
                  <select id="flsaClassification" name="flsaClassification" defaultValue={current?.flsaClassification ?? "EXEMPT"} className={field}>
                    {FLSA_OPTIONS.map(([v]) => <option key={v} value={v}>{t(`enum.flsa.${v}`)}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className={label} htmlFor="payFrequency">{t("field.payFrequency")}</label>
                <select id="payFrequency" name="payFrequency" defaultValue={current?.payFrequency ?? "SEMI_MONTHLY"} className={field}>
                  {PAY_FREQUENCY_OPTIONS.map(([v]) => <option key={v} value={v}>{t(`enum.payFrequency.${v}`)}</option>)}
                </select>
              </div>
              <div>
                <label className={label} htmlFor="departmentId">{t("field.department")}</label>
                <select id="departmentId" name="departmentId" defaultValue={employee.departmentId} className={field}>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label className={label} htmlFor="managerId">{t("field.manager")}</label>
                <select id="managerId" name="managerId" defaultValue={employee.managerId ?? ""} className={field}>
                  <option value="">{t("common.none")}</option>
                  {managerOptions.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              {canEditComp && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={label} htmlFor="salary">{t("field.salary")}</label>
                    <input id="salary" name="salary" defaultValue={current?.salary ?? ""} inputMode="decimal" className={field} />
                  </div>
                  <div>
                    <label className={label} htmlFor="payBasis">{t("field.payBasis")}</label>
                    <select id="payBasis" name="payBasis" defaultValue={current?.payBasis ?? "PER_YEAR"} className={field}>
                      {PAY_BASIS_OPTIONS.map(([v]) => <option key={v} value={v}>{t(`enum.payBasis.${v}`)}</option>)}
                    </select>
                  </div>
                </div>
              )}
              <button type="submit" disabled={mtPending} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
                {mtPending ? t("common.saving") : t("correct.save")}
              </button>
            </form>
          </>
        ) : (
          <p className="mt-3 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground ">
            {t("correct.windowClosed", { days: windowDays })}
          </p>
        )}
      </section>
    </div>
  );
}
