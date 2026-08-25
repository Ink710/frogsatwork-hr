"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getViewer, withViewer } from "@hris/auth";
import { deliverCandidateStageEmail, deliverInterviewerSlotEmail } from "@hris/notifications";
import { prisma } from "@hris/database";
import {
  stageTransitionSchema,
  canTransition,
  firstRound,
  nextRound,
  hasRemainingRounds,
  jobSchema,
  interviewRoundSchema,
  jobMemberSchema,
  competencySchema,
  JOB_STATUSES,
  publicStatusFor,
  interviewSlotSchema,
  zonedWallClockToUtc,
  canPublish,
  formatSlotWhen,
} from "@hris/recruiting";
import { viewerCanManageJob, canCreateJob, isInOrgDirectory } from "@/lib/queries";
import { getT } from "@/lib/i18n.server";
import { portalUrl } from "@/lib/portal-url";

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

/**
 * Reopen a WITHDRAWN application (M13).
 *
 * Exists because a withdrawal was a one-click, unrecoverable action with nothing to drag back —
 * withdrawn cards sit in the Closed list, not a column. Only WITHDRAWN can be reopened; REJECTED
 * stays permanent (see ALLOWED_STAGE_TRANSITIONS for why the two differ).
 *
 * It restores the stage the candidate was AT when they withdrew, read from the append-only trail:
 * the `fromStage` of their most recent withdrawal event. Dropping someone back to APPLIED when they
 * were mid-interview would be its own small data loss, and the trail already knows the answer.
 * APPLIED is the fallback when no such event exists (e.g. seeded data).
 */
export async function reopenApplication(jobId, appId, _prevState) {
  const t = await getT();
  const viewer = await getViewer();
  if (!viewer) return { error: t("err.notAuthorized") };

  try {
    await withViewer(viewer, async (tx) => {
      const app = await requireManageableApplication(tx, viewer, jobId, appId, t);
      if (app.stage !== "WITHDRAWN") throw new Error(t("err.notWithdrawn"));

      const lastWithdrawal = await tx.applicationEvent.findFirst({
        where: { applicationId: appId, toStage: "WITHDRAWN" },
        orderBy: { occurredAt: "desc" },
        select: { fromStage: true },
      });
      const toStage = lastWithdrawal?.fromStage ?? "APPLIED";
      // The trail is data like any other; if it somehow names a stage we can no longer return to,
      // fall back rather than write something the rules forbid.
      const target = canTransition("WITHDRAWN", toStage) ? toStage : "APPLIED";

      const entering = target === "INTERVIEW";
      const first = entering ? firstRound(app.job.interviewRounds) : null;

      await tx.application.update({
        where: { id: appId },
        data: { stage: target, currentRoundId: entering ? (first?.id ?? null) : null },
      });
      await tx.applicationEvent.create({
        data: {
          applicationId: appId,
          jobId,
          fromStage: "WITHDRAWN",
          toStage: target,
          roundName: entering ? (first?.name ?? null) : null,
          actorId: viewer.userId,
        },
      });
    });
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.moveFailed") };
  }

  revalidatePath(`/jobs/${jobId}`);
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

  // Filled inside the transaction, used after it commits — see the send below.
  let pending;

  try {
    await withViewer(viewer, async (tx) => {
      const app = await requireManageableApplication(tx, viewer, jobId, appId, t);
      if (!canTransition(app.stage, toStage)) throw new Error(t("err.invalidTransition"));

      // You may not leave INTERVIEW for OFFER with rounds still to run.
      //
      // The buttons always expressed this implicitly — while rounds remain, a card offers "Next
      // round" and never "Advance to Offer" — but a DRAG has no implicit path, so the rule has to be
      // enforced explicitly here. The board dims Offer as a drop target for the same reason, using
      // this same predicate: the affordance and the enforcement must not be able to disagree, and
      // the server is the one that decides.
      if (
        app.stage === "INTERVIEW" &&
        toStage === "OFFER" &&
        hasRemainingRounds(app.job.interviewRounds, app.currentRoundId)
      ) {
        throw new Error(t("err.roundsRemaining"));
      }

      // Entering INTERVIEW seeds the first round; leaving it clears the pointer.
      //
      // Note what a BACKWARD move into INTERVIEW does (possible since Polish B): it re-seeds round 1,
      // so a re-interview restarts the sequence. The rounds the candidate already sat are not lost —
      // they are in the append-only trail with their roundName snapshots.
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
      const event = await tx.applicationEvent.create({
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

      // M8: everything the notification needs, gathered while we are already inside the
      // transaction. One extra read here beats a second transaction afterwards, and it is the only
      // place the candidate's row is cheaply to hand.
      //
      // ⚠️ `locale` IS THE CANDIDATE'S. Do NOT reach for getT() when composing this message: on this
      // code path it resolves the RECRUITER's cookie, so the applicant would be written to in
      // whatever language the person clicking the button happens to browse in.
      const candidate = await tx.candidate.findUnique({
        where: { id: app.candidateId },
        select: { firstName: true, email: true, locale: true, anonymisedAt: true },
      });
      const job = await tx.job.findUnique({ where: { id: jobId }, select: { title: true } });

      pending = {
        eventId: event.id,
        stageKey: publicStatusFor(toStage).key,
        notify: publicStatusFor(toStage).notify,
        // An erased candidate's address is scrambled to @anonymised.invalid. Never write to it.
        to: candidate?.anonymisedAt ? null : candidate?.email,
        firstName: candidate?.firstName,
        locale: candidate?.locale,
        jobTitle: job?.title,
      };
    });
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.moveFailed") };
  }

  // ⚠️ SENT AFTER THE TRANSACTION COMMITS, AND DELIBERATELY SO. Inside `withViewer` this would hold
  // an interactive transaction — and a pinned pg client — open across an SMTP round trip, and a mail
  // failure would ROLL BACK the stage change. That is exactly backwards: the stage change is the
  // fact, the email is the courtesy. Same shape as createEmployee's post-commit invite in
  // employee-records.
  //
  // Bare `prisma`, not `withViewer`: the delivery doorways are SECURITY DEFINER and scoped by the
  // event, so they need no session — and re-entering a transaction here would defeat the point.
  if (pending?.notify) {
    await deliverCandidateStageEmail({
      db: prisma,
      eventId: pending.eventId,
      stageKey: pending.stageKey,
      to: pending.to,
      firstName: pending.firstName,
      jobTitle: pending.jobTitle,
      locale: pending.locale,
      portalUrl: portalUrl(),
    });
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

// ═════════════════════════════════════════════════════════════════════════════════════════════
// M9 — INTERVIEW SLOTS: propose → confirm → publish → claim.
//
// Four of these are ordinary RLS writes by someone who can manage the req. `confirmSlot` is the
// exception, and the interesting one: the assigned interviewer is typically a JobMember with role
// INTERVIEWER, who can SEE the req but NOT manage it. The database lets them through a narrow
// UPDATE policy (app_can_confirm_interview_slot) that checks their employee id and the slot's state
// — so no role check is written here. RLS decides, exactly as it does everywhere else.
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** Propose a time. The recruiter's own zone is the default, but the form always sends one. */
export async function proposeSlot(jobId, _prevState, formData) {
  const t = await getT();
  const viewer = await getViewer();
  if (!viewer) return { error: t("err.notAuthorized") };

  const parsed = interviewSlotSchema.safeParse({
    roundId: formData.get("roundId"),
    interviewerEmployeeId: formData.get("interviewerEmployeeId"),
    startsAt: formData.get("startsAt"),
    timeZone: formData.get("timeZone"),
    durationMinutes: formData.get("durationMinutes"),
    meetingUrl: formData.get("meetingUrl") || "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t("err.invalidInput") };
  const d = parsed.data;

  // ⚠️ The wall clock is interpreted in the CHOSEN zone, never with `new Date(...)` — that would use
  // the SERVER's zone and store a time hours away from the one the recruiter typed, with nothing
  // looking wrong until a candidate arrived at the wrong hour.
  const startAt = zonedWallClockToUtc(d.startsAt, d.timeZone);
  const endAt = new Date(startAt.getTime() + d.durationMinutes * 60_000);

  // Gathered inside the transaction, used after it commits — same shape as M8's stage-change send.
  let pending;

  try {
    await withViewer(viewer, async (tx) => {
      if (!(await viewerCanManageJob(tx, jobId))) throw new Error(t("err.notAuthorized"));
      const slot = await tx.interviewSlot.create({
        data: {
          jobId,
          roundId: d.roundId,
          interviewerEmployeeId: d.interviewerEmployeeId,
          proposedById: viewer.userId,
          startAt,
          endAt,
          timeZone: d.timeZone,
          meetingUrl: d.meetingUrl || null,
        },
      });

      // ⚠️ THROUGH A DOORWAY. Reading the interviewer with `tx.employee.findFirst` here returns
      // NULL: "Employee" is RLS'd by app_can_see_employee, and a recruiter is not their manager. The
      // first version did exactly that, so the email was skipped and nothing errored — the same trap
      // getJobForManage documents for names, which it resolves via app_org_chart.
      const [person] = await tx.$queryRaw`
        SELECT user_id, email, first_name, job_title, round_name
        FROM app_interview_slot_recipient(${slot.id})`;

      pending = {
        slotId: slot.id,
        recipientUserId: person?.user_id ?? null,
        to: person?.email ?? null,
        firstName: person?.first_name ?? null,
        jobTitle: person?.job_title ?? "",
        roundName: person?.round_name ?? "",
        when: formatSlotWhen({ startAt, endAt, timeZone: d.timeZone }),
      };
    });
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.slotFailed") };
  }

  // ⚠️ AFTER THE COMMIT, and never able to fail the proposal. The slot exists and the /interviews
  // queue already shows it — the email is a nudge, not the mechanism, which is exactly why decision
  // 3 asked for both. In production there is no SMTP provider, so this always fails and is logged;
  // the queue carries the workflow regardless.
  if (pending?.to && pending.recipientUserId) {
    await deliverInterviewerSlotEmail({
      db: prisma,
      slotId: pending.slotId,
      recipientUserId: pending.recipientUserId,
      to: pending.to,
      firstName: pending.firstName,
      jobTitle: pending.jobTitle,
      roundName: pending.roundName,
      when: pending.when,
      // The ATS's OWN base url is right here, unlike a candidate notification: the recipient is
      // staff and /interviews is a page in this app.
      confirmUrl: `${process.env.APP_BASE_URL ?? "http://localhost:3002"}/interviews`,
    });
  }

  revalidatePath(`/jobs/${jobId}/manage`);
  revalidatePath("/interviews");
  return { ok: true };
}

/** The assigned interviewer agrees to sit in it. Nothing reaches a candidate before this. */
export async function confirmSlot(jobId, slotId, _prevState) {
  const t = await getT();
  const viewer = await getViewer();
  if (!viewer) return { error: t("err.notAuthorized") };

  // ⚠️ THROUGH A DOORWAY, NOT AN UPDATE, and the reason is a bug the tests found. `confirmedAt` is
  // REVOKEd from the app role at column level, because RLS could not express "a recruiter may edit
  // this row but not this column" — permissive policies OR together, so the manage policy let a
  // recruiter confirm their own proposal and the two-person rule quietly did not hold.
  let result;
  try {
    result = await withViewer(viewer, async (tx) => {
      const rows = await tx.$queryRaw`SELECT app_confirm_interview_slot(${slotId}) AS result`;
      return rows[0]?.result;
    });
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.slotFailed") };
  }
  if (result === "NOT_FOUND") return { error: t("err.slotNotFound") };
  if (result !== "OK") return { error: t("err.slotNotYours") };

  revalidatePath(`/jobs/${jobId}/manage`);
  revalidatePath("/jobs");
  return { ok: true };
}

/** Offer it to candidates. Refused unless an interviewer has confirmed — the two-person rule. */
export async function publishSlot(jobId, slotId, _prevState) {
  const t = await getT();
  const viewer = await getViewer();
  if (!viewer) return { error: t("err.notAuthorized") };

  try {
    const done = await withViewer(viewer, async (tx) => {
      if (!(await viewerCanManageJob(tx, jobId))) throw new Error(t("err.notAuthorized"));
      const slot = await tx.interviewSlot.findFirst({ where: { id: slotId } });
      if (!slot) throw new Error(t("err.slotNotFound"));
      // The workflow rule lives in @hris/recruiting so it is unit-tested and identical wherever it
      // is asked. Publishing an unconfirmed slot would offer a candidate a time nobody agreed to.
      if (!canPublish(slot)) return false;
      await tx.interviewSlot.update({ where: { id: slotId }, data: { publishedAt: new Date() } });
      return true;
    });
    if (!done) return { error: t("err.slotNotConfirmed") };
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.slotFailed") };
  }

  revalidatePath(`/jobs/${jobId}/manage`);
  return { ok: true };
}

/** Withdraw a slot. Releases any claim, so the candidate can be rebooked for that round. */
export async function cancelSlot(jobId, slotId, _prevState) {
  const t = await getT();
  const viewer = await getViewer();
  if (!viewer) return { error: t("err.notAuthorized") };

  try {
    await withViewer(viewer, async (tx) => {
      if (!(await viewerCanManageJob(tx, jobId))) throw new Error(t("err.notAuthorized"));
      // Clearing the claim is what lets the once-per-round unique constraint accept a replacement:
      // a cancelled-but-still-claimed slot would block that application from ever rebooking.
      await tx.interviewSlot.updateMany({
        where: { id: slotId, cancelledAt: null },
        data: { cancelledAt: new Date(), claimedAt: null, claimedByApplicationId: null },
      });
    });
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.slotFailed") };
  }

  revalidatePath(`/jobs/${jobId}/manage`);
  return { ok: true };
}

/**
 * Book a published slot for one application.
 *
 * ⚠️ THROUGH THE DOORWAY, NOT A PRISMA UPDATE. Two recruiters can be looking at the same pool, so
 * the claim must be one atomic conditional statement — app_claim_interview_slot returns UNAVAILABLE
 * to whoever loses. A read-then-write here would double-book, and the failure would be invisible
 * until two people arrived for the same interview. M11 calls the same function for candidates.
 */
export async function assignSlot(jobId, appId, _prevState, formData) {
  const t = await getT();
  const viewer = await getViewer();
  if (!viewer) return { error: t("err.notAuthorized") };

  const slotId = String(formData.get("slotId") ?? "");
  if (!slotId) return { error: t("err.invalidInput") };

  let result;
  try {
    result = await withViewer(viewer, async (tx) => {
      if (!(await viewerCanManageJob(tx, jobId))) throw new Error(t("err.notAuthorized"));
      const rows = await tx.$queryRaw`SELECT app_claim_interview_slot(${slotId}, ${appId}) AS result`;
      return rows[0]?.result;
    });
  } catch (e) {
    return { error: errorMessage(e) ?? t("err.slotFailed") };
  }

  if (result === "UNAVAILABLE") return { error: t("err.slotTaken") };
  if (result === "ALREADY_BOOKED") return { error: t("err.slotAlreadyBooked") };
  if (result !== "OK") return { error: t("err.slotNotFound") };

  revalidatePath(`/jobs/${jobId}/applications/${appId}`);
  revalidatePath(`/jobs/${jobId}/manage`);
  return { ok: true };
}
