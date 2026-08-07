"use server";

import { revalidatePath } from "next/cache";
import { getViewer, withViewer } from "@hris/auth";
import { stageTransitionSchema, canTransition, firstRound, nextRound } from "@hris/recruiting";
import { viewerCanManageJob } from "@/lib/queries";
import { getT } from "@/lib/i18n.server";

function errorMessage(e) {
  // Never surface internal DB errors (Prisma throws PrismaClient* errors) — only intentional messages.
  if (e instanceof Error && e.name.startsWith("PrismaClient")) return undefined;
  return e instanceof Error ? e.message : undefined;
}

// Load the application (RLS-scoped) with its job's ordered interview rounds, or throw. Shared by both
// actions so the "must be visible + manageable" checks live in one place.
async function requireManageableApplication(tx, viewer, jobId, appId, t) {
  if (!(await viewerCanManageJob(tx, jobId))) throw new Error(t("err.notAuthorized"));
  const app = await tx.application.findFirst({
    where: { id: appId, jobId },
    include: {
      job: {
        select: {
          interviewRounds: { orderBy: { position: "asc" }, select: { id: true, name: true, position: true } },
        },
      },
    },
  });
  if (!app) throw new Error(t("err.applicationNotFound"));
  return app;
}

// Move an application to a new stage (Advance / Reject / Withdraw). Enforces the pipeline rules
// (canTransition), records an append-only ApplicationEvent, and — when entering INTERVIEW — seeds the
// first interview round. The RLS write policy (app_can_manage_job) is the DB-level backstop.
export async function moveApplication(jobId, appId, _prevState, formData) {
  const t = await getT();
  const viewer = await getViewer();
  if (!viewer) return { error: t("err.notAuthorized") };

  const parsed = stageTransitionSchema.safeParse({
    toStage: formData.get("toStage"),
    note: formData.get("note") || undefined,
    rejectionReason: formData.get("rejectionReason") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t("err.invalidInput") };
  const { toStage, note, rejectionReason } = parsed.data;

  try {
    await withViewer(viewer, async (tx) => {
      const app = await requireManageableApplication(tx, viewer, jobId, appId, t);
      if (!canTransition(app.stage, toStage)) throw new Error(t("err.invalidTransition"));

      // Entering INTERVIEW seeds the first round; leaving it clears the pointer.
      const entering = toStage === "INTERVIEW";
      const first = entering ? firstRound(app.job.interviewRounds) : null;

      await tx.application.update({
        where: { id: appId },
        data: {
          stage: toStage,
          currentRoundId: entering ? (first?.id ?? null) : null,
          rejectionReason: toStage === "REJECTED" ? (rejectionReason ?? null) : null,
        },
      });
      await tx.applicationEvent.create({
        data: {
          applicationId: appId,
          jobId,
          fromStage: app.stage,
          toStage,
          roundName: entering ? (first?.name ?? null) : null,
          note: note ?? null,
          actorId: viewer.userId,
        },
      });
    });
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.moveFailed") };
  }

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/applications/${appId}`);
  return { ok: true };
}

// Advance an in-INTERVIEW application to its next interview round. At the last round the UI offers
// "Advance to Offer" (a moveApplication) instead, so this errs there.
export async function advanceRound(jobId, appId, _prevState) {
  const t = await getT();
  const viewer = await getViewer();
  if (!viewer) return { error: t("err.notAuthorized") };

  try {
    await withViewer(viewer, async (tx) => {
      const app = await requireManageableApplication(tx, viewer, jobId, appId, t);
      if (app.stage !== "INTERVIEW") throw new Error(t("err.notInterview"));
      const next = nextRound(app.job.interviewRounds, app.currentRoundId);
      if (!next) throw new Error(t("err.atLastRound"));

      await tx.application.update({ where: { id: appId }, data: { currentRoundId: next.id } });
      await tx.applicationEvent.create({
        data: {
          applicationId: appId,
          jobId,
          fromStage: "INTERVIEW",
          toStage: "INTERVIEW",
          roundName: next.name,
          actorId: viewer.userId,
        },
      });
    });
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.moveFailed") };
  }

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/applications/${appId}`);
  return { ok: true };
}
