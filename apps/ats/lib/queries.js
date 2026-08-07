import "server-only";
import { getViewer, withViewer } from "@hris/auth";
import { APPLICATION_STAGES } from "@hris/recruiting";

// The active pipeline columns, in order. REJECTED / WITHDRAWN are shown separately (see `closed`).
export const BOARD_STAGES = ["APPLIED", "SCREEN", "INTERVIEW", "OFFER", "HIRED"];
const CLOSED_STAGES = ["REJECTED", "WITHDRAWN"];

// Rows per page in the candidate database. Small enough that pagination is demoable.
export const CANDIDATE_PAGE_SIZE = 8;

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

// ---------------------------------------------------------------------------
// Candidate database (M4) — the "have we seen this person before?" surface.
// ---------------------------------------------------------------------------

// A calendar date string "YYYY-MM-DD" → UTC midnight (suite convention), or null if absent/invalid.
function utcMidnight(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Search + filter the candidate database. RLS (app_can_see_candidate) scopes it for free: recruiters
// and HR see everyone in the org; a hiring-team member sees only people who applied to their reqs.
//
// Rejected/withdrawn candidates are INCLUDED by design — this is a talent pool you re-search later,
// and each row's stage badge tells the story.
export async function getCandidates({ q, stage, jobId, source, appliedFrom, appliedTo, page = 1 } = {}) {
  const viewer = await getViewer();
  const empty = { rows: [], total: 0, page: 1, pageSize: CANDIDATE_PAGE_SIZE, pageCount: 1 };
  if (!viewer) return empty;

  const and = [];

  // Free-text: every whitespace token must match at least one field, so "Mei Tanaka" matches across
  // firstName + lastName without a dedicated full-name column (same trick as getEmployees).
  for (const token of (q ?? "").trim().split(/\s+/).filter(Boolean)) {
    and.push({
      OR: [
        { firstName: { contains: token, mode: "insensitive" } },
        { lastName: { contains: token, mode: "insensitive" } },
        { email: { contains: token, mode: "insensitive" } },
      ],
    });
  }

  // `source` lives on Candidate → a direct clause.
  if (source) and.push({ source });

  // stage / job / applied-date are all APPLICATION fields. They must be ANDed INSIDE ONE `some`, i.e.
  // "has a single application matching all of them". Pushing them as separate `some` clauses would
  // wrongly match a candidate whose DIFFERENT applications each satisfy a different filter — e.g.
  // rejected on job A + at Offer on job B would match "job A at Offer". (Locked by a test.)
  const appClauses = [];
  if (stage && APPLICATION_STAGES.includes(stage)) appClauses.push({ stage });
  if (jobId) appClauses.push({ jobId });
  const from = utcMidnight(appliedFrom);
  const to = utcMidnight(appliedTo);
  if (from) appClauses.push({ appliedAt: { gte: from } });
  // `to` is INCLUSIVE of the whole day → compare against the next midnight.
  if (to) appClauses.push({ appliedAt: { lt: new Date(to.getTime() + 86_400_000) } });
  if (appClauses.length) and.push({ applications: { some: { AND: appClauses } } });

  const where = and.length ? { AND: and } : {};

  return withViewer(viewer, async (tx) => {
    // Count and page in the SAME tx so the total matches what's paged under RLS.
    const total = await tx.candidate.count({ where });
    const pageCount = Math.max(1, Math.ceil(total / CANDIDATE_PAGE_SIZE));
    const safePage = Math.min(Math.max(1, page | 0 || 1), pageCount); // ?page=99 → last page

    const rows = await tx.candidate.findMany({
      where,
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      skip: (safePage - 1) * CANDIDATE_PAGE_SIZE,
      take: CANDIDATE_PAGE_SIZE,
      include: {
        _count: { select: { applications: true } },
        // Just the newest application, for the row's badge.
        applications: {
          orderBy: { appliedAt: "desc" },
          take: 1,
          select: { id: true, stage: true, appliedAt: true, job: { select: { id: true, title: true } } },
        },
      },
    });

    return {
      rows: rows.map((c) => {
        const latest = c.applications[0] ?? null;
        return {
          id: c.id,
          name: `${c.firstName} ${c.lastName}`,
          email: c.email,
          source: c.source,
          applicationCount: c._count.applications,
          latest: latest && {
            id: latest.id,
            stage: latest.stage,
            appliedAt: latest.appliedAt,
            jobId: latest.job.id,
            jobTitle: latest.job.title,
          },
        };
      }),
      total,
      page: safePage,
      pageSize: CANDIDATE_PAGE_SIZE,
      pageCount,
    };
  });
}

// One person, with EVERY application they've made that the viewer may see — the cross-job history
// that the Candidate/Application split exists to make possible. null when RLS hides them.
export async function getCandidateProfile(candidateId) {
  const viewer = await getViewer();
  if (!viewer) return null;
  return withViewer(viewer, async (tx) => {
    const candidate = await tx.candidate.findFirst({
      where: { id: candidateId },
      include: {
        applications: {
          orderBy: { appliedAt: "desc" },
          select: {
            id: true,
            stage: true,
            appliedAt: true,
            rejectionReason: true,
            job: { select: { id: true, title: true } },
            currentRound: { select: { name: true } },
          },
        },
      },
    });
    return candidate ?? null;
  });
}

// Options for the filter dropdowns — both RLS-scoped, so a hiring manager only ever sees their own
// reqs and the sources present in candidates they can see.
export async function getCandidateFilterOptions() {
  const viewer = await getViewer();
  if (!viewer) return { jobs: [], sources: [] };
  return withViewer(viewer, async (tx) => {
    const jobs = await tx.job.findMany({ orderBy: { title: "asc" }, select: { id: true, title: true } });
    const grouped = await tx.candidate.groupBy({
      by: ["source"],
      where: { source: { not: null } },
      orderBy: { source: "asc" },
    });
    return { jobs, sources: grouped.map((g) => g.source).filter(Boolean) };
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
