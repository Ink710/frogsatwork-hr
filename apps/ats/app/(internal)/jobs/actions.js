"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getViewer, withViewer } from "@hris/auth";
import {
  stageTransitionSchema,
  canTransition,
  firstRound,
  nextRound,
  jobSchema,
  interviewRoundSchema,
  jobMemberSchema,
  competencySchema,
  JOB_STATUSES,
} from "@hris/recruiting";
import { viewerCanManageJob, canCreateJob, isInOrgDirectory } from "@/lib/queries";
import { getT } from "@/lib/i18n.server";

function errorMessage(e) {
  // Never surface internal DB errors (Prisma throws PrismaClient* errors) — only intentional messages.
  if (e instanceof Error && e.name.startsWith("PrismaClient")) return undefined;
  return e instanceof Error ? e.message : undefined;
}

// ---------------------------------------------------------------------------
// Job requisition management (M5)
// ---------------------------------------------------------------------------

function parseJob(formData) {
  return jobSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    location: formData.get("location") || undefined,
    employmentType: formData.get("employmentType"),
    openings: formData.get("openings"),
    departmentId: formData.get("departmentId") || undefined,
    eeoJobCategory: formData.get("eeoJobCategory") || undefined,
  });
}

// Assert the viewer may manage this job, using the very DB function the RLS write policy uses.
async function requireManageableJob(tx, jobId, t) {
  if (!(await viewerCanManageJob(tx, jobId))) throw new Error(t("err.notAuthorized"));
}

// Open a new requisition. Gate is app-layer (a new job has no members yet); the `job_insert` RLS
// policy enforces the same rule at the DB. The creator is auto-added to the hiring team as a
// RECRUITER so the req has traceable ownership and stays manageable by them specifically.
export async function createJob(_prevState, formData) {
  const t = await getT();
  const viewer = await getViewer();
  if (!canCreateJob(viewer)) return { error: t("err.notAuthorizedCreate") };
  const parsed = parseJob(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t("err.invalidInput") };
  const d = parsed.data;

  // Generate the id ourselves so we can INSERT without RETURNING — see the raw insert below.
  const newId = randomUUID();
  try {
    await withViewer(viewer, async (tx) => {
      // RAW INSERT, deliberately. Prisma's create() issues `INSERT … RETURNING`, and RETURNING makes
      // Postgres apply the SELECT policy (job_read → app_can_see_job) to the brand-new row — which
      // looks the job up in the table, can't see it mid-insert, and fails:
      //     ERROR: new row violates row-level security policy for table "Job"
      // (Verified in psql: the same INSERT without RETURNING succeeds.) This is the identical
      // workaround createEmployee uses in employee-records for exactly the same reason.
      await tx.$executeRaw`
        INSERT INTO "Job" (id, title, description, location, "employmentType", status, openings,
                           "eeoJobCategory", "createdAt", "updatedAt", "orgId", "departmentId",
                           "createdById")
        VALUES (${newId}, ${d.title}, ${d.description ?? null}, ${d.location ?? null},
                ${d.employmentType}::"EmploymentType", 'DRAFT', ${d.openings},
                ${d.eeoJobCategory ?? null}::"EeoJobCategory",
                now(), now(), ${viewer.orgId}, ${d.departmentId ?? null}, ${viewer.userId})`;
      // Now the row exists, so app_can_manage_job can find it and the normal client works again.
      // Only when the creator has an employee record (an HR user might not).
      if (viewer.employeeId) {
        await tx.jobMember.create({
          data: { jobId: newId, employeeId: viewer.employeeId, role: "RECRUITER", addedById: viewer.userId },
        });
      }
    });
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.jobCreateFailed") };
  }

  revalidatePath("/");
  redirect(`/jobs/${newId}/manage`);
}

// Edit a req's details (hiring managers + recruiters/HR).
export async function updateJob(jobId, _prevState, formData) {
  const t = await getT();
  const viewer = await getViewer();
  if (!viewer) return { error: t("err.notAuthorized") };
  const parsed = parseJob(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t("err.invalidInput") };
  const d = parsed.data;

  try {
    await withViewer(viewer, async (tx) => {
      await requireManageableJob(tx, jobId, t);
      await tx.job.update({
        where: { id: jobId },
        data: {
          title: d.title,
          description: d.description ?? null,
          location: d.location ?? null,
          employmentType: d.employmentType,
          openings: d.openings,
          departmentId: d.departmentId ?? null,
          eeoJobCategory: d.eeoJobCategory ?? null,
        },
      });
    });
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.jobUpdateFailed") };
  }
  revalidatePath(`/jobs/${jobId}/manage`);
  revalidatePath("/");
  return { ok: true };
}

// Move a posting through its lifecycle. Reqs are never deleted — CLOSED / FILLED are the archive
// states, so the pipeline and its history survive.
export async function setJobStatus(jobId, _prevState, formData) {
  const t = await getT();
  const viewer = await getViewer();
  if (!viewer) return { error: t("err.notAuthorized") };
  const status = formData.get("status");
  if (!JOB_STATUSES.includes(status)) return { error: t("err.invalidInput") };

  try {
    await withViewer(viewer, async (tx) => {
      await requireManageableJob(tx, jobId, t);
      await tx.job.update({ where: { id: jobId }, data: { status } });
    });
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.jobUpdateFailed") };
  }
  revalidatePath(`/jobs/${jobId}/manage`);
  revalidatePath("/");
  return { ok: true };
}

// Post a req to the public careers page, or pull it back. Deliberately SEPARATE from status: a job
// can be OPEN internally without being advertised (confidential backfills, exec searches), so
// publishing is its own explicit act. Only OPEN + published reqs are reachable publicly — enforced
// in the DB by app_public_jobs() / app_submit_application(), not just here.
export async function setJobPublished(jobId, publish, _prevState) {
  const t = await getT();
  const viewer = await getViewer();
  if (!viewer) return { error: t("err.notAuthorized") };
  try {
    await withViewer(viewer, async (tx) => {
      await requireManageableJob(tx, jobId, t);
      await tx.job.update({
        where: { id: jobId },
        data: { publishedAt: publish ? new Date() : null },
      });
    });
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.jobUpdateFailed") };
  }
  revalidatePath(`/jobs/${jobId}/manage`);
  revalidatePath("/careers");
  return { ok: true };
}

// --- Interview rounds (the per-job INTERVIEW sub-steps) ---

// Append a round at the end of the order.
export async function addRound(jobId, _prevState, formData) {
  const t = await getT();
  const viewer = await getViewer();
  if (!viewer) return { error: t("err.notAuthorized") };
  const name = formData.get("name");
  const parsed = interviewRoundSchema.safeParse({ name, position: 0 }); // position is assigned below
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t("err.invalidInput") };

  try {
    await withViewer(viewer, async (tx) => {
      await requireManageableJob(tx, jobId, t);
      const last = await tx.interviewRound.findFirst({
        where: { jobId },
        orderBy: { position: "desc" },
        select: { position: true },
      });
      await tx.interviewRound.create({
        data: { jobId, name: parsed.data.name, position: (last?.position ?? -1) + 1 },
      });
    });
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.roundFailed") };
  }
  revalidatePath(`/jobs/${jobId}/manage`);
  return { ok: true };
}

export async function renameRound(jobId, roundId, _prevState, formData) {
  const t = await getT();
  const viewer = await getViewer();
  if (!viewer) return { error: t("err.notAuthorized") };
  const parsed = interviewRoundSchema.safeParse({ name: formData.get("name"), position: 0 });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t("err.invalidInput") };

  try {
    await withViewer(viewer, async (tx) => {
      await requireManageableJob(tx, jobId, t);
      // updateMany is RLS-scoped: a round on a job the viewer can't manage simply matches nothing.
      const { count } = await tx.interviewRound.updateMany({
        where: { id: roundId, jobId },
        data: { name: parsed.data.name },
      });
      if (count === 0) throw new Error(t("err.roundNotFound"));
    });
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.roundFailed") };
  }
  revalidatePath(`/jobs/${jobId}/manage`);
  return { ok: true };
}

// Remove a round. Application.currentRoundId is ON DELETE SET NULL (M1), so a candidate sitting in
// this round is never orphaned — they stay in INTERVIEW with no current round, and the recruiter can
// move them on. Their ApplicationEvent history is untouched because it stores a roundName SNAPSHOT.
export async function removeRound(jobId, roundId, _prevState) {
  const t = await getT();
  const viewer = await getViewer();
  if (!viewer) return { error: t("err.notAuthorized") };
  try {
    await withViewer(viewer, async (tx) => {
      await requireManageableJob(tx, jobId, t);
      const { count } = await tx.interviewRound.deleteMany({ where: { id: roundId, jobId } });
      if (count === 0) throw new Error(t("err.roundNotFound"));
    });
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.roundFailed") };
  }
  revalidatePath(`/jobs/${jobId}/manage`);
  return { ok: true };
}

// --- Competencies (what this job scores candidates on) ---
//
// Same shape as the interview-round actions above: manage-gated, appended in order, and safe to
// remove because ScorecardRating keeps a competencyName SNAPSHOT — deleting a competency can never
// rewrite what a past debrief said.

export async function addCompetency(jobId, _prevState, formData) {
  const t = await getT();
  const viewer = await getViewer();
  if (!viewer) return { error: t("err.notAuthorized") };
  const parsed = competencySchema.safeParse({ name: formData.get("name"), position: 0 });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t("err.invalidInput") };

  try {
    await withViewer(viewer, async (tx) => {
      await requireManageableJob(tx, jobId, t);
      const last = await tx.jobCompetency.findFirst({
        where: { jobId },
        orderBy: { position: "desc" },
        select: { position: true },
      });
      await tx.jobCompetency.create({
        data: { jobId, name: parsed.data.name, position: (last?.position ?? -1) + 1 },
      });
    });
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.competencyFailed") };
  }
  revalidatePath(`/jobs/${jobId}/manage`);
  return { ok: true };
}

export async function renameCompetency(jobId, competencyId, _prevState, formData) {
  const t = await getT();
  const viewer = await getViewer();
  if (!viewer) return { error: t("err.notAuthorized") };
  const parsed = competencySchema.safeParse({ name: formData.get("name"), position: 0 });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t("err.invalidInput") };

  try {
    await withViewer(viewer, async (tx) => {
      await requireManageableJob(tx, jobId, t);
      const { count } = await tx.jobCompetency.updateMany({
        where: { id: competencyId, jobId },
        data: { name: parsed.data.name },
      });
      if (count === 0) throw new Error(t("err.competencyNotFound"));
    });
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.competencyFailed") };
  }
  revalidatePath(`/jobs/${jobId}/manage`);
  return { ok: true };
}

export async function removeCompetency(jobId, competencyId, _prevState) {
  const t = await getT();
  const viewer = await getViewer();
  if (!viewer) return { error: t("err.notAuthorized") };
  try {
    await withViewer(viewer, async (tx) => {
      await requireManageableJob(tx, jobId, t);
      const { count } = await tx.jobCompetency.deleteMany({ where: { id: competencyId, jobId } });
      if (count === 0) throw new Error(t("err.competencyNotFound"));
    });
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.competencyFailed") };
  }
  revalidatePath(`/jobs/${jobId}/manage`);
  return { ok: true };
}

// --- Hiring team ---

export async function addJobMember(jobId, _prevState, formData) {
  const t = await getT();
  const viewer = await getViewer();
  if (!viewer) return { error: t("err.notAuthorized") };
  const parsed = jobMemberSchema.safeParse({
    employeeId: formData.get("employeeId"),
    role: formData.get("role"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t("err.invalidInput") };

  try {
    await withViewer(viewer, async (tx) => {
      await requireManageableJob(tx, jobId, t);
      // Never trust the posted id: confirm it's a real, current person in the viewer's org. Checked
      // through app_org_chart rather than an RLS-scoped employee read, because a RECRUITER has no
      // employee-records visibility by design — they may staff a team by NAME without gaining access
      // to anyone's HR record. (Cross-org ids simply aren't in the directory.)
      const ok = await isInOrgDirectory(tx, viewer.orgId, parsed.data.employeeId);
      if (!ok) throw new Error(t("err.employeeNotAssignable"));
      const existing = await tx.jobMember.findFirst({ where: { jobId, employeeId: parsed.data.employeeId } });
      if (existing) throw new Error(t("err.alreadyOnTeam"));
      await tx.jobMember.create({
        data: { jobId, employeeId: parsed.data.employeeId, role: parsed.data.role, addedById: viewer.userId },
      });
    });
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.teamFailed") };
  }
  revalidatePath(`/jobs/${jobId}/manage`);
  return { ok: true };
}

// Remove someone from the hiring team — but never the LAST person who can manage the req, which
// would strand it with nobody able to edit it or move candidates.
export async function removeJobMember(jobId, memberId, _prevState) {
  const t = await getT();
  const viewer = await getViewer();
  if (!viewer) return { error: t("err.notAuthorized") };
  try {
    await withViewer(viewer, async (tx) => {
      await requireManageableJob(tx, jobId, t);
      const member = await tx.jobMember.findFirst({ where: { id: memberId, jobId }, select: { id: true, role: true } });
      if (!member) throw new Error(t("err.memberNotFound"));
      if (member.role === "RECRUITER" || member.role === "HIRING_MANAGER") {
        const managers = await tx.jobMember.count({
          where: { jobId, role: { in: ["RECRUITER", "HIRING_MANAGER"] } },
        });
        if (managers <= 1) throw new Error(t("err.lastManager"));
      }
      await tx.jobMember.deleteMany({ where: { id: memberId, jobId } });
    });
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.teamFailed") };
  }
  revalidatePath(`/jobs/${jobId}/manage`);
  return { ok: true };
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
    rejectionCategory: formData.get("rejectionCategory") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t("err.invalidInput") };
  const { toStage, note, rejectionReason, rejectionCategory } = parsed.data;

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
          // Both rejection fields are set together and cleared together.
          //
          // The clearing branch is currently UNREACHABLE: REJECTED is terminal in
          // ALLOWED_STAGE_TRANSITIONS, so nothing can move out of it. It is written this way anyway
          // so that if reversal is ever allowed, a stale reason cannot survive the move and quietly
          // misreport why someone back in the pipeline was once rejected.
          rejectionReason: toStage === "REJECTED" ? (rejectionReason ?? null) : null,
          rejectionCategory: toStage === "REJECTED" ? (rejectionCategory ?? null) : null,
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
