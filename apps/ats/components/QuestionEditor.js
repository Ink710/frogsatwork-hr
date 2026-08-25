"use client";

import { useActionState, useState } from "react";
import { useT } from "@hris/ui/client";
import { QUESTION_TYPES } from "@hris/recruiting";
import {
  addQuestion,
  updateQuestion,
  archiveQuestion,
  restoreQuestion,
} from "@/app/(internal)/jobs/questions";

const INPUT =
  "rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";
const BTN = "rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-60";

// Options only apply to a select, so the textarea appears only for that type — showing it always
// would invite a recruiter to fill in options that the schema then rejects.
function TypeFields({ t, type, setType, defaults }) {
  return (
    <>
      <select name="type" value={type} onChange={(e) => setType(e.target.value)} className={INPUT}>
        {QUESTION_TYPES.map((v) => (
          <option key={v} value={v}>
            {t(`enum.questionType.${v}`)}
          </option>
        ))}
      </select>
      {type === "SINGLE_SELECT" && (
        <textarea
          name="options"
          rows={3}
          defaultValue={(defaults?.options ?? []).join("\n")}
          placeholder={t("questions.optionsPlaceholder")}
          aria-label={t("questions.options")}
          className={`${INPUT} w-full`}
        />
      )}
    </>
  );
}

function QuestionRow({ jobId, question }) {
  const t = useT();
  const [type, setType] = useState(question.type);
  const [editing, setEditing] = useState(false);
  const [saveState, saveAction, saving] = useActionState(
    updateQuestion.bind(null, jobId, question.id),
    undefined,
  );
  const [toggleState, toggleAction, toggling] = useActionState(
    async () =>
      question.archivedAt ? restoreQuestion(jobId, question.id) : archiveQuestion(jobId, question.id),
    undefined,
  );
  const error = saveState?.error || toggleState?.error;
  const archived = Boolean(question.archivedAt);

  return (
    <li className={`rounded-lg border border-border p-3 ${archived ? "opacity-60" : ""}`}>
      {editing ? (
        <form action={saveAction} className="flex flex-col gap-2">
          <input name="prompt" defaultValue={question.prompt} required className={`${INPUT} w-full`} />
          <div className="flex flex-wrap items-center gap-2">
            <TypeFields t={t} type={type} setType={setType} defaults={question} />
            <label className="flex items-center gap-1 text-xs">
              <input name="required" type="checkbox" defaultChecked={question.required} />
              {t("questions.required")}
            </label>
            <button type="submit" disabled={saving} className={BTN}>
              {t("questions.save")}
            </button>
            <button type="button" onClick={() => setEditing(false)} className={BTN}>
              {t("common.cancel")}
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium">{question.prompt}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {[
                t(`enum.questionType.${question.type}`),
                question.required ? t("questions.requiredPill") : t("questions.optionalPill"),
                question.options?.length ? question.options.join(" · ") : null,
                archived ? t("questions.archivedPill") : null,
                t("questions.answers", { n: question.answerCount ?? 0 }),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!archived && (
              <button type="button" onClick={() => setEditing(true)} className={BTN}>
                {t("questions.edit")}
              </button>
            )}
            <form action={toggleAction}>
              <button type="submit" disabled={toggling} className={BTN}>
                {archived ? t("questions.restore") : t("questions.archive")}
              </button>
            </form>
          </div>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </li>
  );
}

export function QuestionEditor({ jobId, questions }) {
  const t = useT();
  const [type, setType] = useState("SHORT_TEXT");
  const [state, action, pending] = useActionState(addQuestion.bind(null, jobId), undefined);

  return (
    <div>
      <p className="mb-3 text-xs text-muted-foreground">{t("questions.hint")}</p>

      {questions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("questions.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {questions.map((q) => (
            <QuestionRow key={q.id} jobId={jobId} question={q} />
          ))}
        </ul>
      )}

      <form action={action} className="mt-4 flex flex-col gap-2">
        <input
          name="prompt"
          required
          placeholder={t("questions.promptPlaceholder")}
          aria-label={t("questions.prompt")}
          className={`${INPUT} w-full`}
        />
        <div className="flex flex-wrap items-center gap-2">
          <TypeFields t={t} type={type} setType={setType} />
          <label className="flex items-center gap-1 text-xs">
            <input name="required" type="checkbox" />
            {t("questions.required")}
          </label>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {t("questions.add")}
          </button>
        </div>
      </form>
      {state?.error && <p className="mt-2 text-sm text-destructive">{state.error}</p>}
    </div>
  );
}
