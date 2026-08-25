"use server";

import { revalidatePath } from "next/cache";
import { getViewer, withViewer } from "@hris/auth";
import { questionSchema, parseOptions } from "@hris/recruiting";
import { viewerCanManageJob } from "@/lib/queries";
import { getT } from "@/lib/i18n.server";

// Per-job screening questions (M6b). Shaped exactly like the competency actions next door: the
// app-layer gate is `viewerCanManageJob`, which runs the very DB function the RLS write policy uses,
// so button visibility can never drift from actual enforcement — and RLS refuses regardless.

function parse(formData) {
  const type = formData.get("type");
  return questionSchema.safeParse({
    prompt: formData.get("prompt"),
    type,
    required: formData.get("required") === "on",
    // Options only mean anything for a select; sending them for other types is a definition error
    // the schema reports rather than silently ignoring.
    options: type === "SINGLE_SELECT" ? parseOptions(formData.get("options")) : [],
  });
}

async function requireManage(tx, jobId, t) {
  if (!(await viewerCanManageJob(tx, jobId))) throw new Error(t("err.notAuthorized"));
}

export async function addQuestion(jobId, _prevState, formData) {
  const t = await getT();
  const viewer = await getViewer();
  if (!viewer) return { error: t("err.notAuthorized") };
  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t("err.invalidInput") };

  try {
    await withViewer(viewer, async (tx) => {
      await requireManage(tx, jobId, t);
      // Append after the highest existing position, INCLUDING archived ones — their positions are
      // still occupied, and reusing a number would interleave a new question with old answers'
      // ordering for no reason.
      const last = await tx.jobQuestion.findFirst({
        where: { jobId },
        orderBy: { position: "desc" },
        select: { position: true },
      });
      await tx.jobQuestion.create({
        data: {
          jobId,
          prompt: parsed.data.prompt,
          type: parsed.data.type,
          required: parsed.data.required,
          options: parsed.data.options,
          position: (last?.position ?? -1) + 1,
        },
      });
    });
  } catch (e) {
    return { error: e?.message ?? t("questions.saveFailed") };
  }

  revalidatePath(`/jobs/${jobId}/manage`);
  return { ok: true };
}

// Editing a live question is allowed, and safe, because every answer already carries a SNAPSHOT of
// the prompt as it was asked. Rewording changes what FUTURE applicants see, never what past ones
// appear to have answered.
export async function updateQuestion(jobId, questionId, _prevState, formData) {
  const t = await getT();
  const viewer = await getViewer();
  if (!viewer) return { error: t("err.notAuthorized") };
  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t("err.invalidInput") };

  try {
    await withViewer(viewer, async (tx) => {
      await requireManage(tx, jobId, t);
      // updateMany scoped by jobId as well as id: RLS already prevents cross-job writes, but the
      // extra clause means a wrong id matches nothing instead of relying solely on the policy.
      const { count } = await tx.jobQuestion.updateMany({
        where: { id: questionId, jobId },
        data: {
          prompt: parsed.data.prompt,
          type: parsed.data.type,
          required: parsed.data.required,
          options: parsed.data.options,
        },
      });
      if (count === 0) throw new Error(t("questions.notFound"));
    });
  } catch (e) {
    return { error: e?.message ?? t("questions.saveFailed") };
  }

  revalidatePath(`/jobs/${jobId}/manage`);
  return { ok: true };
}

// ARCHIVE, never delete.
//
// Deleting would orphan every answer (the FK is SetNull), leaving rows that record a response to
// nothing. Archiving stops the question being ASKED — app_public_job_questions excludes archived
// ones, and app_submit_application discards answers aimed at them — while the answers it already
// produced stay readable beside their applications. Reversible, like every other archive here.
async function setArchived(jobId, questionId, archivedAt) {
  const t = await getT();
  const viewer = await getViewer();
  if (!viewer) return { error: t("err.notAuthorized") };

  try {
    await withViewer(viewer, async (tx) => {
      await requireManage(tx, jobId, t);
      const { count } = await tx.jobQuestion.updateMany({
        where: { id: questionId, jobId },
        data: { archivedAt },
      });
      if (count === 0) throw new Error(t("questions.notFound"));
    });
  } catch (e) {
    return { error: e?.message ?? t("questions.saveFailed") };
  }

  revalidatePath(`/jobs/${jobId}/manage`);
  return { ok: true };
}

export async function archiveQuestion(jobId, questionId) {
  return setArchived(jobId, questionId, new Date());
}

export async function restoreQuestion(jobId, questionId) {
  return setArchived(jobId, questionId, null);
}
