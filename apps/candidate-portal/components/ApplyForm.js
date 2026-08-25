"use client";

import { useActionState } from "react";
import { useT } from "@hris/ui/client";
import { submitApplication } from "@/app/jobs/[id]/apply/actions";
import {
  INPUT,
  LABEL,
  emptyJob,
  emptyStudy,
  useRows,
  EmploymentRows,
  EducationRows,
} from "@/components/HistoryRows";

export function ApplyForm({ jobId, source, profile, questions = [] }) {
  const t = useT();
  const [state, action, pending] = useActionState(
    submitApplication.bind(null, jobId, source ?? null),
    undefined,
  );

  // Prefilled for a signed-in applicant — the account benefit made real. An anonymous applicant
  // starts empty, and both submit through exactly the same path.
  const jobs = useRows(profile?.employment ?? [], emptyJob);
  const studies = useRows(profile?.education ?? [], emptyStudy);

  return (
    <form action={action} className="flex flex-col gap-6">
      {/* Honeypot: off-screen, never focusable, never announced. */}
      <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <input type="hidden" name="employment" value={JSON.stringify(jobs.rows)} />
      <input type="hidden" name="education" value={JSON.stringify(studies.rows)} />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={LABEL}>{t("apply.firstName")}</span>
          <input name="firstName" required autoComplete="given-name" defaultValue={profile?.firstName ?? ""} className={INPUT} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>{t("apply.lastName")}</span>
          <input name="lastName" required autoComplete="family-name" defaultValue={profile?.lastName ?? ""} className={INPUT} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>{t("apply.email")}</span>
          <input name="email" type="email" required autoComplete="email" defaultValue={profile?.email ?? ""} className={INPUT} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>{t("apply.phone")}</span>
          <input name="phone" type="tel" autoComplete="tel" defaultValue={profile?.phone ?? ""} className={INPUT} />
        </label>
      </section>

      <section>
        <h3 className="text-sm font-semibold">{t("apply.experience")}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{t("apply.experienceHint")}</p>
        <EmploymentRows jobs={jobs} t={t} />
      </section>

      <section>
        <h3 className="text-sm font-semibold">{t("apply.education")}</h3>
        <EducationRows studies={studies} t={t} />
      </section>

      {/* The req's own screening questions (M6b). Field names are `answer:<questionId>` — the id the
          server already knows — so there is no naming convention for both sides to agree on. */}
      {questions.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold">{t("apply.questions")}</h3>
          <div className="mt-3 flex flex-col gap-4">
            {questions.map((q) => (
              <QuestionField key={q.id} question={q} t={t} inputClass={INPUT} labelClass={LABEL} />
            ))}
          </div>
        </section>
      )}

      <label className="flex flex-col gap-1">
        <span className={LABEL}>{t("apply.resume")}</span>
        <input
          name="resume" type="file" accept=".pdf,.doc,.docx"
          className={`${INPUT} file:mr-3 file:rounded file:border-0 file:bg-muted file:px-3 file:py-1 file:text-sm`}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className={LABEL}>{t("apply.note")}</span>
        <textarea name="note" rows={4} className={INPUT} />
      </label>

      {/* The voluntary EEO block. Every field defaults to "prefer not to say" — a refusal is a real
          answer the compliance report needs, not a blank we later guess at. */}
      <EeoSection t={t} inputClass={INPUT} labelClass={LABEL} />

      <label className="flex items-start gap-2 rounded-lg border border-border p-3">
        <input name="consent" type="checkbox" className="mt-1" />
        <span className="text-sm text-muted-foreground">{t("apply.consent")}</span>
      </label>

      <button
        type="submit" disabled={pending}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
      >
        {pending ? t("apply.submitting") : t("apply.submit")}
      </button>

      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
    </form>
  );
}

// One question, rendered by type. `required` is marked in the UI but NOT set as an HTML `required`
// attribute alone — the server re-checks, and app_submit_application refuses independently, because
// a public endpoint cannot depend on its own form having run.
function QuestionField({ question, t, inputClass, labelClass }) {
  const name = `answer:${question.id}`;
  const label = (
    <span className={labelClass}>
      {question.prompt}
      {question.required && <span className="ml-1 text-destructive">*</span>}
    </span>
  );

  if (question.type === "LONG_TEXT") {
    return (
      <label className="flex flex-col gap-1">
        {label}
        <textarea name={name} rows={4} required={question.required} className={inputClass} />
      </label>
    );
  }
  if (question.type === "YES_NO") {
    return (
      <label className="flex flex-col gap-1">
        {label}
        <select name={name} defaultValue="" required={question.required} className={inputClass}>
          <option value="">{t("apply.choose")}</option>
          <option value="Yes">{t("apply.yes")}</option>
          <option value="No">{t("apply.no")}</option>
        </select>
      </label>
    );
  }
  if (question.type === "SINGLE_SELECT") {
    return (
      <label className="flex flex-col gap-1">
        {label}
        <select name={name} defaultValue="" required={question.required} className={inputClass}>
          <option value="">{t("apply.choose")}</option>
          {(question.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <label className="flex flex-col gap-1">
      {label}
      <input name={name} required={question.required} className={inputClass} />
    </label>
  );
}

const EEO_FIELDS = [
  ["eeoGender", "gender", ["DECLINED", "MALE", "FEMALE", "NON_BINARY"]],
  ["eeoEthnicity", "ethnicity", ["DECLINED", "WHITE", "ASIAN", "HISPANIC_OR_LATINO", "BLACK_OR_AFRICAN_AMERICAN", "TWO_OR_MORE_RACES"]],
  ["eeoVeteranStatus", "veteran", ["DECLINED", "NOT_A_VETERAN", "PROTECTED_VETERAN"]],
  ["eeoDisabilityStatus", "disability", ["DECLINED", "NO", "YES"]],
];

function EeoSection({ t, inputClass, labelClass }) {
  return (
    <section className="rounded-lg border border-dashed border-border p-4">
      <h3 className="text-sm font-semibold">{t("apply.eeoTitle")}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{t("apply.eeoHint")}</p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {EEO_FIELDS.map(([name, key, options]) => (
          <label key={name} className="flex flex-col gap-1">
            <span className={labelClass}>{t(`apply.eeo.${key}`)}</span>
            <select name={name} defaultValue="DECLINED" className={inputClass}>
              {options.map((o) => (
                <option key={o} value={o}>
                  {t(`enum.eeo.${o}`)}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </section>
  );
}
