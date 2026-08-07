import "server-only";
import { getViewer, withViewer } from "@hris/auth";

// The active pipeline columns, in order. REJECTED / WITHDRAWN are shown separately (see `closed`).
export const BOARD_STAGES = ["APPLIED", "SCREEN", "INTERVIEW", "OFFER", "HIRED"];
const CLOSED_STAGES = ["REJECTED", "WITHDRAWN"];

// Does the viewer MANAGE this job? Runs the exact DB function the RLS write policy uses
// (app_can_manage_job), so button visibility can never drift from actual enforcement — one source of
// truth. Must be called inside a withViewer tx (it reads the app.current_* session vars).
export async function viewerCanManageJob(tx, jobId) {
  const [row] = await tx.$queryRaw`SELECT app_can_manage_job(${jobId}) AS ok`;
  return Boolean(row?.ok);
}

// Jobs the viewer can SEE (RLS: recruiter/HR org-wide; hiring-team members their reqs) + pipeline
// counts. Drives the landing list. Empty for a user on no hiring teams.
export async function getJobsForViewer() {
  const viewer = await getViewer();
  if (!viewer) return [];
  return withViewer(viewer, async (tx) => {
    const jobs = await tx.job.findMany({
      orderBy: [{ status: "asc" }, { title: "asc" }],
      include: { _count: { select: { applications: true } } },
    });
    return jobs.map((j) => ({
      id: j.id,
      title: j.title,
      status: j.status,
      location: j.location,
      openings: j.openings,
      applicationCount: j._count.applications,
    }));
  });
}

// The full pipeline board for one job: the job, its ordered interview rounds, its applications
// grouped into active columns + a closed list, and whether the viewer may manage it. Returns null
// when RLS hides the job (caller → notFound()).
export async function getJobBoard(jobId) {
  const viewer = await getViewer();
  if (!viewer) return null;
  return withViewer(viewer, async (tx) => {
    const job = await tx.job.findFirst({
      where: { id: jobId },
      include: {
        interviewRounds: {
          orderBy: { position: "asc" },
          select: { id: true, name: true, position: true },
        },
      },
    });
    if (!job) return null;

    const applications = await tx.application.findMany({
      where: { jobId },
      orderBy: { appliedAt: "asc" },
      include: {
        candidate: { select: { id: true, firstName: true, lastName: true, source: true } },
        currentRound: { select: { id: true, name: true } },
      },
    });

    const columns = Object.fromEntries(BOARD_STAGES.map((s) => [s, []]));
    const closed = [];
    for (const a of applications) {
      const card = {
        id: a.id,
        stage: a.stage,
        candidateName: `${a.candidate.firstName} ${a.candidate.lastName}`,
        source: a.candidate.source,
        appliedAt: a.appliedAt,
        currentRoundId: a.currentRoundId,
        currentRound: a.currentRound?.name ?? null,
      };
      if (CLOSED_STAGES.includes(a.stage)) closed.push(card);
      else columns[a.stage].push(card);
    }

    const canManage = await viewerCanManageJob(tx, jobId);
    return {
      job: {
        id: job.id,
        title: job.title,
        status: job.status,
        location: job.location,
        openings: job.openings,
      },
      rounds: job.interviewRounds,
      columns,
      closed,
      canManage,
    };
  });
}

// One application's detail: candidate + the full ApplicationEvent timeline + canManage. Returns null
// when RLS hides it (caller → notFound()).
export async function getApplicationDetail(jobId, appId) {
  const viewer = await getViewer();
  if (!viewer) return null;
  return withViewer(viewer, async (tx) => {
    const app = await tx.application.findFirst({
      where: { id: appId, jobId },
      include: {
        candidate: {
          select: { firstName: true, lastName: true, email: true, phone: true, source: true },
        },
        currentRound: { select: { name: true } },
        job: { select: { id: true, title: true } },
        events: {
          orderBy: { occurredAt: "asc" },
          select: { id: true, fromStage: true, toStage: true, roundName: true, note: true, occurredAt: true },
        },
      },
    });
    if (!app) return null;
    const canManage = await viewerCanManageJob(tx, jobId);
    return { app, canManage };
  });
}
