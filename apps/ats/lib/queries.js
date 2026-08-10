import "server-only";
import { prisma } from "@hris/database";
import { getViewer, withViewer, isRecruiter } from "@hris/auth";
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
// Collaboration — competencies + scorecards (M7).
// ---------------------------------------------------------------------------

// The criteria this job scores on, in order. RLS: readable by the whole hiring team.
export async function getJobCompetencies(jobId) {
  const viewer = await getViewer();
  if (!viewer) return [];
  return withViewer(viewer, (tx) =>
    tx.jobCompetency.findMany({
      where: { jobId },
      orderBy: { position: "asc" },
      select: { id: true, name: true, position: true },
    }),
  );
}

// The viewer's OWN scorecard for an application (plus the job's competencies and their current
// ratings), creating nothing. Returns null when they're not on the hiring team at all.
export async function getMyScorecard(applicationId) {
  const viewer = await getViewer();
  if (!viewer?.employeeId) return null;
  return withViewer(viewer, async (tx) => {
    const application = await tx.application.findFirst({
      where: { id: applicationId },
      select: { id: true, jobId: true, currentRoundId: true },
    });
    if (!application) return null; // RLS hid it → not on this job

    const [competencies, scorecard] = await Promise.all([
      tx.jobCompetency.findMany({
        where: { jobId: application.jobId },
        orderBy: { position: "asc" },
        select: { id: true, name: true },
      }),
      tx.scorecard.findFirst({
        where: { applicationId, authorEmployeeId: viewer.employeeId },
        include: { ratings: { select: { competencyId: true, rating: true, comment: true } } },
      }),
    ]);

    return { application, competencies, scorecard };
  });
}

// The debrief: every scorecard on this application the viewer is ALLOWED to read, plus how many are
// being withheld.
//
// The hidden count is deliberate. RLS already hides colleagues' feedback until you've submitted your
// own — but silently returning fewer rows would read as "nobody has reviewed yet", which is a lie.
// Telling someone "2 colleagues have submitted; submit yours to read them" is honest AND reinforces
// the rule. The count comes from a SECURITY DEFINER aggregate so it reveals a NUMBER and nothing else.
export async function getApplicationScorecards(applicationId) {
  const viewer = await getViewer();
  if (!viewer) return { scorecards: [], hiddenCount: 0 };
  return withViewer(viewer, async (tx) => {
    const scorecards = await tx.scorecard.findMany({
      where: { applicationId },
      orderBy: [{ submittedAt: "asc" }, { createdAt: "asc" }],
      include: { ratings: { orderBy: { competencyName: "asc" } } },
    });

    // Total submitted, regardless of visibility — one integer, via the owner-privileged helper.
    const [{ total }] = await tx.$queryRaw`
      SELECT app_submitted_scorecard_count(${applicationId}) AS total`;
    const visibleSubmitted = scorecards.filter((s) => s.status === "SUBMITTED").length;
    const hiddenCount = Math.max(0, Number(total) - visibleSubmitted);

    // Resolve author names structurally — a RECRUITER has no employee-records access (the M5 lesson).
    const directory = await orgDirectory(tx, viewer.orgId);
    const byId = new Map(directory.map((p) => [p.id, p]));

    return {
      scorecards: scorecards.map((s) => ({
        ...s,
        authorName: byId.get(s.authorEmployeeId)
          ? `${byId.get(s.authorEmployeeId).firstName} ${byId.get(s.authorEmployeeId).lastName}`
          : "—",
        isMine: s.authorEmployeeId === viewer.employeeId,
      })),
      hiddenCount,
    };
  });
}

// ---------------------------------------------------------------------------
// PUBLIC careers site (M6) — no viewer, no session, no withViewer.
// ---------------------------------------------------------------------------

// Postings visible to the open internet: OPEN *and* published. Uses the bare `prisma` client (not
// withViewer) because the caller is anonymous — which is safe here precisely because these are the
// rows we've chosen to advertise, and only non-sensitive columns are selected. Job has RLS enabled;
// with no session variables `app_can_see_job` is false, so we must go through the same
// SECURITY DEFINER boundary the write path uses — see app_public_jobs in the migration.
export async function getPublishedJobs() {
  return prisma.$queryRaw`
    SELECT id, title, location, "employmentType"::text AS "employmentType", "publishedAt"
    FROM app_public_jobs()
    ORDER BY "publishedAt" DESC, title ASC`;
}

// One public posting, or null. Same boundary; also returns the description for the detail page.
export async function getPublishedJob(jobId) {
  const [row] = await prisma.$queryRaw`
    SELECT id, title, description, location, "employmentType"::text AS "employmentType", "publishedAt"
    FROM app_public_jobs() WHERE id = ${jobId}`;
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Job requisition management (M5).
// ---------------------------------------------------------------------------

// May this viewer OPEN a brand-new req? A new job has no JobMember rows yet, so app_can_manage_job
// (which decides by membership-or-role) can't be the gate at creation time — this is an app-layer
// decision. The DB backstop is the `job_insert` RLS policy, which enforces the SAME rule against the
// new row's own columns (org match + recruiting role).
export function canCreateJob(viewer) {
  return Boolean(viewer) && isRecruiter(viewer.role);
}

// Departments for the job form's select. Department has no RLS (it isn't employee-scoped), so a
// plain read is correct here.
export async function getJobFormData() {
  const viewer = await getViewer();
  if (!viewer) return { departments: [] };
  return withViewer(viewer, async (tx) => {
    const departments = await tx.department.findMany({
      where: { orgId: viewer.orgId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    return { departments };
  });
}

// Structural directory of the org — id, name, job title, department only. Uses app_org_chart, the
// SECURITY DEFINER function that deliberately exposes NO compensation or contact data.
//
// Why this and not `tx.employee.findMany`: a RECRUITER intentionally gets NO employee-records
// visibility (they aren't in app_can_see_employee's privileged roles), so an RLS-scoped employee
// query returns only themselves — they could never staff a hiring team. The org chart function is
// the suite's established answer to exactly this ("I need colleagues' NAMES, not their HR records"),
// already used by the org chart page and time-management's schedule/roster.
async function orgDirectory(tx, orgId) {
  return tx.$queryRaw`SELECT id, "firstName", "lastName", "jobTitle" FROM app_org_chart(${orgId}) ORDER BY "lastName", "firstName"`;
}

// Everything the manage screen needs: the job, its ordered rounds, its hiring team (names resolved
// structurally), and whether the viewer may change any of it. null when RLS hides the job.
export async function getJobForManage(jobId) {
  const viewer = await getViewer();
  if (!viewer) return null;
  return withViewer(viewer, async (tx) => {
    const job = await tx.job.findFirst({
      where: { id: jobId },
      include: {
        interviewRounds: { orderBy: { position: "asc" }, select: { id: true, name: true, position: true } },
        competencies: { orderBy: { position: "asc" }, select: { id: true, name: true, position: true } },
        // Deliberately NOT `include: { employee }` — that relation is Employee-RLS-filtered, so a
        // recruiter would see null for every teammate. Names come from the directory below.
        members: { orderBy: { createdAt: "asc" }, select: { id: true, role: true, employeeId: true } },
      },
    });
    if (!job) return null;

    const directory = await orgDirectory(tx, viewer.orgId);
    const byId = new Map(directory.map((p) => [p.id, p]));
    const members = job.members.map((m) => {
      const p = byId.get(m.employeeId);
      return {
        id: m.id,
        role: m.role,
        employeeId: m.employeeId,
        name: p ? `${p.firstName} ${p.lastName}` : "—",
        jobTitle: p?.jobTitle ?? null,
      };
    });

    const canManage = await viewerCanManageJob(tx, jobId);
    return { job: { ...job, members }, canManage };
  });
}

// People who can be added to a hiring team — the structural directory (see orgDirectory).
export async function getAssignableEmployees() {
  const viewer = await getViewer();
  if (!viewer) return [];
  return withViewer(viewer, async (tx) => {
    const rows = await orgDirectory(tx, viewer.orgId);
    return rows.map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}`, jobTitle: p.jobTitle }));
  });
}

// Is this employee id a real, current member of the viewer's org? Validated through the same
// structural function, so adding a teammate never requires HR-record access.
export async function isInOrgDirectory(tx, orgId, employeeId) {
  const [row] = await tx.$queryRaw`SELECT 1 AS ok FROM app_org_chart(${orgId}) WHERE id = ${employeeId}`;
  return Boolean(row);
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
