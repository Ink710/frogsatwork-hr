import "server-only";
import { prisma } from "@hris/database";
import { getViewer, withViewer, isRecruiter } from "@hris/auth";
import {
  APPLICATION_STAGES,
  buildFunnel,
  summariseSources,
  daysBetween,
  averageDays,
  suppressSmallCells,
  resolveRetentionDays,
  summariseRejections,
} from "@hris/recruiting";

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

    // ONE relation, deliberately. Two or more relations in a single include make Prisma fire their
    // sub-queries CONCURRENTLY on this transaction's pinned pg client, which is exactly the
    // "client.query() when the client is already executing a query" deprecation (an error in pg@9).
    //
    // `currentRound` used to be the second relation here — dropped rather than split, because the
    // job's rounds are already loaded above and the round is always one of them. A lookup beats a
    // query.
    const roundsById = new Map(job.interviewRounds.map((r) => [r.id, r]));

    const applications = await tx.application.findMany({
      where: { jobId },
      orderBy: { appliedAt: "asc" },
      include: {
        candidate: { select: { id: true, firstName: true, lastName: true, source: true } },
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
        currentRound: roundsById.get(a.currentRoundId)?.name ?? null,
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

    // Sequential (not Promise.all): queries on one tx/connection can't run concurrently.
    // An interactive transaction pins a single pg client, so issuing both at once triggers
    // "Calling client.query() when the client is already executing a query is deprecated and will be
    // removed in pg@9.0" — benign today, a hard error on the next major.
    const competencies = await tx.jobCompetency.findMany({
      where: { jobId: application.jobId },
      orderBy: { position: "asc" },
      select: { id: true, name: true },
    });
    const scorecard = await tx.scorecard.findFirst({
      where: { applicationId, authorEmployeeId: viewer.employeeId },
      include: { ratings: { select: { competencyId: true, rating: true, comment: true } } },
    });

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
    const job = await tx.job.findFirst({ where: { id: jobId } });
    if (!job) return null;

    // SEQUENTIAL, not a three-relation include: concurrent sub-queries on one transaction's pinned
    // client trip pg's "already executing a query" deprecation (a hard error in pg@9).
    const interviewRounds = await tx.interviewRound.findMany({
      where: { jobId },
      orderBy: { position: "asc" },
      select: { id: true, name: true, position: true },
    });
    const competencies = await tx.jobCompetency.findMany({
      where: { jobId },
      orderBy: { position: "asc" },
      select: { id: true, name: true, position: true },
    });
    // Deliberately NOT `include: { employee }` — that relation is Employee-RLS-filtered, so a
    // recruiter would see null for every teammate. Names come from the directory below.
    const jobMembers = await tx.jobMember.findMany({
      where: { jobId },
      orderBy: { createdAt: "asc" },
      select: { id: true, role: true, employeeId: true },
    });

    const directory = await orgDirectory(tx, viewer.orgId);
    const byId = new Map(directory.map((p) => [p.id, p]));
    const members = jobMembers.map((m) => {
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
    return { job: { ...job, interviewRounds, competencies, members }, canManage };
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
export async function getCandidates({
  q,
  stage,
  jobId,
  source,
  appliedFrom,
  appliedTo,
  includeAnonymised = false,
  includeArchived = false,
  page = 1,
} = {}) {
  const viewer = await getViewer();
  const empty = { rows: [], total: 0, page: 1, pageSize: CANDIDATE_PAGE_SIZE, pageCount: 1 };
  if (!viewer) return empty;

  const and = [];

  // Erased candidates are hidden by DEFAULT. A shell has no name, no email and no phone, so to a
  // recruiter searching the talent pool it is pure noise — but it is NOT deleted, and the totals on
  // /reports still count it, so the filter exists to make the two views reconcilable on demand.
  if (!includeAnonymised) and.push({ anonymisedAt: null });

  // Archived candidates are hidden by default too, but for a different reason than erased ones: an
  // archived person is entirely intact, just no longer part of the ACTIVE pool. Both filters exist
  // so the list can be reconciled against /reports on demand — the reports count everyone.
  if (!includeArchived) and.push({ archivedAt: null });

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
    });

    // SEQUENTIAL follow-ups rather than `include: { _count, applications }`. Two relations (a count
    // aggregate counts) in one include run concurrently on this transaction's pinned client, which
    // trips pg's "already executing a query" deprecation.
    //
    // Scoped to the CURRENT PAGE's ids, so this is two small queries regardless of pool size.
    const pageIds = rows.map((c) => c.id);
    const pageApplications = pageIds.length
      ? await tx.application.findMany({
          where: { candidateId: { in: pageIds } },
          orderBy: { appliedAt: "desc" },
          select: {
            id: true,
            stage: true,
            appliedAt: true,
            candidateId: true,
            job: { select: { id: true, title: true } },
          },
        })
      : [];
    const counts = pageIds.length
      ? await tx.application.groupBy({
          by: ["candidateId"],
          where: { candidateId: { in: pageIds } },
          _count: { _all: true },
        })
      : [];

    // Ordered newest-first above, so the first hit per candidate IS the newest.
    const newestByCandidate = new Map();
    for (const a of pageApplications) {
      if (!newestByCandidate.has(a.candidateId)) newestByCandidate.set(a.candidateId, a);
    }
    const countByCandidate = new Map(counts.map((c) => [c.candidateId, c._count._all]));

    return {
      rows: rows.map((c) => {
        const latest = newestByCandidate.get(c.id) ?? null;
        return {
          id: c.id,
          name: `${c.firstName} ${c.lastName}`,
          email: c.email,
          source: c.source,
          // Present on a shell so the row can render as a tombstone rather than as a person with an
          // odd name and an undeliverable address.
          anonymisedAt: c.anonymisedAt,
          // Archived people render normally with a muted pill — they're intact, just not active.
          archivedAt: c.archivedAt,
          applicationCount: countByCandidate.get(c.id) ?? 0,
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
    const candidate = await tx.candidate.findFirst({ where: { id: candidateId } });
    if (!candidate) return null;

    // SEQUENTIAL, and note the nesting is what mattered: `job` and `currentRound` were two SIBLING
    // relations inside the applications select, so Prisma fired them concurrently on this
    // transaction's pinned client (pg's "already executing a query" deprecation). Keeping `job`
    // inline leaves exactly one relation; the round names come from a second query.
    const applications = await tx.application.findMany({
      where: { candidateId },
      orderBy: { appliedAt: "desc" },
      select: {
        id: true,
        stage: true,
        appliedAt: true,
        rejectionReason: true,
        currentRoundId: true,
        // Whether this application produced an employee (M8). The profile needs it to know
        // whether erasure is even offerable — see app_erase_candidate's HIRED refusal.
        hiredEmployeeId: true,
        job: { select: { id: true, title: true } },
      },
    });

    const roundIds = applications.map((a) => a.currentRoundId).filter(Boolean);
    const rounds = roundIds.length
      ? await tx.interviewRound.findMany({
          where: { id: { in: roundIds } },
          select: { id: true, name: true },
        })
      : [];
    const roundsById = new Map(rounds.map((r) => [r.id, r]));

    // Who archived them, resolved STRUCTURALLY through the org directory rather than an Employee
    // relation — a RECRUITER has no employee-records access, so `include: { archivedBy: true }`
    // would come back null for exactly the people who use this screen (the M5 lesson).
    // A null archivedById means the retention sweep did it, not a person.
    let archivedByName = null;
    if (candidate.archivedById) {
      const person = (await orgDirectory(tx, viewer.orgId)).find((p) => p.id === candidate.archivedById);
      archivedByName = person ? `${person.firstName} ${person.lastName}` : null;
    }
    return {
      ...candidate,
      // Shaped exactly as the include produced it, so the profile page is untouched.
      applications: applications.map((a) => ({
        ...a,
        currentRound: a.currentRoundId ? (roundsById.get(a.currentRoundId) ?? null) : null,
      })),
      archivedByName,
    };
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
    // FIVE sibling relations used to hang off this one query — the worst offender for pg's
    // "already executing a query" deprecation, since Prisma fired all five sub-queries at once onto
    // this transaction's single pinned client. Split into sequential fetches; the returned SHAPE is
    // identical, so the detail page is untouched.
    const app = await tx.application.findFirst({
      where: { id: appId, jobId },
      include: {
        candidate: {
          select: { firstName: true, lastName: true, email: true, phone: true, source: true },
        },
      },
    });
    if (!app) return null;

    const job = await tx.job.findFirst({ where: { id: app.jobId }, select: { id: true, title: true } });
    const events = await tx.applicationEvent.findMany({
      where: { applicationId: appId },
      orderBy: { occurredAt: "asc" },
      select: { id: true, fromStage: true, toStage: true, roundName: true, note: true, occurredAt: true },
    });
    const currentRound = app.currentRoundId
      ? await tx.interviewRound.findFirst({ where: { id: app.currentRoundId }, select: { name: true } })
      : null;
    // M8: set once HR has actually created this person's employee record.
    const hiredEmployee = app.hiredEmployeeId
      ? await tx.employee.findFirst({
          where: { id: app.hiredEmployeeId },
          select: { id: true, employeeNumber: true },
        })
      : null;

    const canManage = await viewerCanManageJob(tx, jobId);
    return { app: { ...app, job, events, currentRound, hiredEmployee }, canManage };
  });
}

// ---------------------------------------------------------------------------
// Reporting (M9).
//
// THE RULE FOR THIS WHOLE SECTION: every count, sum and average is computed INSIDE withViewer, so
// Postgres RLS scopes the rows before any arithmetic happens. A recruiter's numbers cover the org;
// a hiring manager's cover only the reqs they're on — from the SAME code, with no role branching.
// Dropping to a bare `prisma` aggregate "for speed" would silently hand a hiring manager the whole
// company's hiring data, which is exactly the kind of leak an aggregate makes hard to notice.
// ---------------------------------------------------------------------------

// Does this viewer manage ANY requisition? Gates the interviewer-load report — see below.
async function viewerManagesAnyJob(tx) {
  const [row] = await tx.$queryRaw`
    SELECT EXISTS (SELECT 1 FROM "Job" j WHERE app_can_manage_job(j.id)) AS ok`;
  return Boolean(row?.ok);
}

// The pipeline funnel: how many applications EVER REACHED each stage.
//
// Counted from the append-only ApplicationEvent trail, NOT from Application.stage — someone sitting
// at OFFER also passed Screen and Interview, and counting them once (at the end) makes every
// drop-off figure fiction. DISTINCT on applicationId matters too: a multi-round INTERVIEW advance
// writes several INTERVIEW→INTERVIEW events, and that's one candidate, not three.
export async function getFunnelReport() {
  const viewer = await getViewer();
  if (!viewer) return { funnel: buildFunnel({}), totalApplications: 0 };
  return withViewer(viewer, async (tx) => {
    const rows = await tx.$queryRaw`
      SELECT "toStage"::text AS stage, count(DISTINCT "applicationId")::int AS reached
      FROM "ApplicationEvent"
      GROUP BY "toStage"`;
    const reached = Object.fromEntries(rows.map((r) => [r.stage, Number(r.reached)]));
    const totalApplications = await tx.application.count();
    return { funnel: buildFunnel(reached), totalApplications };
  });
}

// Where candidates come from, and which sources actually produce hires.
export async function getSourceReport() {
  const viewer = await getViewer();
  if (!viewer) return [];
  return withViewer(viewer, async (tx) => {
    // Hires are counted from the HIRED EVENT, not from Application.stage — the same source of truth
    // the funnel and the time metrics use, so the three can never contradict each other on one page.
    // It's also the more honest definition: a hire is a historical fact. Current stage can be edited
    // afterwards, which would silently erase a hire that really happened; the append-only event trail
    // is precisely what stops that.
    const rows = await tx.$queryRaw`
      SELECT c.source,
             count(*)::int AS applications,
             count(*) FILTER (
               WHERE EXISTS (
                 SELECT 1 FROM "ApplicationEvent" e
                 WHERE e."applicationId" = a.id AND e."toStage" = 'HIRED'
               )
             )::int AS hires
      FROM "Application" a
      JOIN "Candidate" c ON c.id = a."candidateId"
      GROUP BY c.source`;
    return summariseSources(
      rows.map((r) => ({ source: r.source, applications: Number(r.applications), hires: Number(r.hires) })),
    );
  });
}

// Two different questions, deliberately reported separately:
//   time-to-hire — applied → hired. The candidate's experience and the pipeline's speed.
//   time-to-fill — req published → the hire that completed it. How long the business waited.
// Both derived from event timestamps; neither is stored, so neither can drift (the same argument
// the suite makes for overtime).
export async function getTimeReport() {
  const viewer = await getViewer();
  const empty = { timeToHire: { days: null, sample: 0 }, timeToFill: { days: null, sample: 0 } };
  if (!viewer) return empty;
  return withViewer(viewer, async (tx) => {
    const hires = await tx.$queryRaw`
      SELECT a."appliedAt", j."publishedAt", MIN(e."occurredAt") AS "hiredAt"
      FROM "Application" a
      JOIN "Job" j ON j.id = a."jobId"
      JOIN "ApplicationEvent" e ON e."applicationId" = a.id AND e."toStage" = 'HIRED'
      GROUP BY a.id, a."appliedAt", j."publishedAt"`;

    const toHire = hires.map((h) => daysBetween(h.appliedAt, h.hiredAt));
    // Only reqs that were actually advertised have a meaningful "waiting" clock.
    const toFill = hires.filter((h) => h.publishedAt).map((h) => daysBetween(h.publishedAt, h.hiredAt));
    return { timeToHire: averageDays(toHire), timeToFill: averageDays(toFill) };
  });
}

// OPEN requisitions and how long they've been open — surfaces reqs that are stalling before anyone
// complains. DRAFT/PAUSED/CLOSED/FILLED are excluded: only a live vacancy is "aging".
export async function getReqAgingReport() {
  const viewer = await getViewer();
  if (!viewer) return [];
  return withViewer(viewer, async (tx) => {
    const jobs = await tx.job.findMany({
      where: { status: "OPEN" },
      select: {
        id: true, title: true, publishedAt: true, createdAt: true, openings: true,
        _count: { select: { applications: true } },
      },
    });
    const now = new Date();
    return jobs
      // publishedAt when advertised, else createdAt — an unadvertised req still ages internally.
      .map((j) => ({
        id: j.id,
        title: j.title,
        openings: j.openings,
        inFlight: j._count.applications,
        daysOpen: daysBetween(j.publishedAt ?? j.createdAt, now),
        published: Boolean(j.publishedAt),
      }))
      .sort((a, b) => b.daysOpen - a.daysOpen);
  });
}

// Scorecards submitted vs still in draft, per interviewer.
//
// GATED to viewers who manage at least one req. The M7 anchoring guard means an interviewer cannot
// read colleagues' scorecards — so for them these totals would silently omit most of the data and
// read as fact. A wrong number is worse than a hidden section, so they get null and the page hides
// it (visibility follows capability — the M8 lesson).
export async function getInterviewerLoadReport() {
  const viewer = await getViewer();
  if (!viewer) return null;
  return withViewer(viewer, async (tx) => {
    if (!(await viewerManagesAnyJob(tx))) return null;

    const rows = await tx.$queryRaw`
      SELECT s."authorEmployeeId" AS "employeeId",
             count(*) FILTER (WHERE s.status = 'SUBMITTED')::int AS submitted,
             count(*) FILTER (WHERE s.status = 'DRAFT')::int     AS drafts
      FROM "Scorecard" s
      GROUP BY s."authorEmployeeId"`;
    if (rows.length === 0) return [];

    // Names structurally — a recruiter has no employee-records access (the M5 lesson).
    const directory = await orgDirectory(tx, viewer.orgId);
    const byId = new Map(directory.map((p) => [p.id, p]));
    return rows
      .map((r) => {
        const p = byId.get(r.employeeId);
        return {
          employeeId: r.employeeId,
          name: p ? `${p.firstName} ${p.lastName}` : "—",
          submitted: Number(r.submitted),
          drafts: Number(r.drafts),
        };
      })
      .sort((a, b) => b.submitted - a.submitted || a.name.localeCompare(b.name));
  });
}

// ── Compliance (M10) ─────────────────────────────────────────────────────────────────────────────

// May the viewer read EEO aggregates / action erasure requests? Both call the EXACT DB functions the
// policies and doorways use, so what the page renders can never drift from what the database will
// actually permit — the same single-source-of-truth argument as viewerCanManageJob.
export async function canReadEeo() {
  const viewer = await getViewer();
  if (!viewer) return false;
  return withViewer(viewer, async (tx) => {
    const [row] = await tx.$queryRaw`SELECT app_can_read_eeo() AS ok`;
    return Boolean(row?.ok);
  });
}

export async function canManageErasure() {
  const viewer = await getViewer();
  if (!viewer) return false;
  return withViewer(viewer, async (tx) => {
    const [row] = await tx.$queryRaw`SELECT app_can_manage_erasure() AS ok`;
    return Boolean(row?.ok);
  });
}

// Aggregate EEO demographics for the viewer's organisation.
//
// Note what is NOT here: any way to read one person's answers. The table itself is unreadable (RLS
// with no policies + REVOKE), so this goes through app_eeo_summary, which returns counts and only
// counts, and only to HR_ADMIN. Suppression is then applied in pure code.
//
// Returns null — not an empty array — when the viewer isn't permitted, so the page can say "you
// don't have access" instead of "no data". Those are different sentences and only one of them is
// true (the M7 hiddenCount lesson).
export async function getEeoSummary({ jobId } = {}) {
  const viewer = await getViewer();
  if (!viewer) return null;
  return withViewer(viewer, async (tx) => {
    const [gate] = await tx.$queryRaw`SELECT app_can_read_eeo() AS ok`;
    if (!gate?.ok) return null;

    const rows = await tx.$queryRaw`
      SELECT dimension, value, responses FROM app_eeo_summary(${jobId ?? null})`;
    const dimensions = suppressSmallCells(
      rows.map((r) => ({ dimension: r.dimension, value: r.value, responses: Number(r.responses) })),
    );
    // Every dimension stores DECLINED explicitly, so any one of them sums to the response total.
    return { dimensions, totalResponses: dimensions[0]?.total ?? 0 };
  });
}

// The erasure queue. RLS already restricts this table to HR_ADMIN, but the page gates on
// canManageErasure() too: a screen offering an irreversible action should never render for someone
// who can't perform it (the M8 lesson — visibility follows capability).
export async function getErasureRequests({ status = "PENDING" } = {}) {
  const viewer = await getViewer();
  if (!viewer) return [];
  return withViewer(viewer, async (tx) =>
    tx.erasureRequest.findMany({
      where: status ? { status } : {},
      orderBy: { requestedAt: "asc" }, // oldest first: a compliance queue is a deadline, not a feed
      select: {
        id: true,
        email: true,
        status: true,
        reason: true,
        decisionNote: true,
        requestedAt: true,
        resolvedAt: true,
        candidateId: true,
        candidate: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            anonymisedAt: true,
            // Whether this person became an employee — the one case the doorway will refuse. Shown
            // in the queue so HR knows BEFORE they click, rather than learning from an error.
            applications: { where: { hiredEmployeeId: { not: null } }, select: { id: true }, take: 1 },
          },
        },
      },
    }),
  );
}

// ── Retention / archive (M11) ────────────────────────────────────────────────────────────────────

// May the viewer archive and restore candidates?
//
// ⚠️ App-layer only, and deliberately so. `candidate_visibility` is a FOR ALL policy, so anyone who
// can SEE a candidate can technically UPDATE them — a hiring manager included. Erasure is gated in
// the DATABASE because it is irreversible and destroys evidence; archiving is reversible
// housekeeping, so a server-side role check is the proportionate weight. The asymmetry is the point:
// the strength of the guard should match the cost of getting it wrong.
export function canArchiveCandidate(viewer) {
  return Boolean(viewer) && isRecruiter(viewer.role);
}

// How many idle days before the sweep archives someone. Stored in AppSetting so HR can change the
// policy without a deploy — the same runtime-settings pattern as employee-records' storage folder.
//
// AppSetting is a GLOBAL table (no orgId, no RLS), so this is a deployment-wide policy. A bare
// prisma read is therefore correct here: there is no viewer, and nothing to scope it to.
export async function getRetentionDays() {
  const row = await prisma.appSetting.findUnique({ where: { key: "candidateRetentionDays" } });
  return resolveRetentionDays(row?.value);
}

// Every candidate in one org with the two facts the retention rule needs: when they were last
// touched, and what stages they're sitting in. Must be called inside a withViewer tx.
//
// `lastActivityAt` falls back to the candidate's own createdAt, so someone who applied and then had
// nothing happen to them still has a clock running. Without that fallback they'd return
// UNKNOWN_ACTIVITY forever and never be archived — the exact people you most want swept.
export async function getArchiveCandidates(tx) {
  const rows = await tx.$queryRaw`
    SELECT c.id,
           GREATEST(c."createdAt", COALESCE(MAX(e."occurredAt"), c."createdAt")) AS "lastActivityAt",
           c."archivedAt",
           c."anonymisedAt",
           COALESCE(array_agg(DISTINCT a.stage::text) FILTER (WHERE a.id IS NOT NULL), '{}') AS stages
      FROM "Candidate" c
      LEFT JOIN "Application" a ON a."candidateId" = c.id
      LEFT JOIN "ApplicationEvent" e ON e."applicationId" = a.id
     GROUP BY c.id, c."createdAt", c."archivedAt", c."anonymisedAt"`;
  return rows.map((r) => ({ ...r, stages: r.stages ?? [] }));
}

// Why candidates are rejected (M12), from the STRUCTURED category.
//
// The point of this report is that it still works after someone is forgotten: an erasure blanks
// `rejectionReason` (free text is where names hide) but leaves `rejectionCategory` alone, because a
// category describes a decision rather than a person. Counting the enum instead of the prose is the
// difference between a report that survives the GDPR path and one that quietly empties out.
//
// RLS-scoped like every other figure on /reports: a recruiter sees the organisation, a hiring
// manager sees their own reqs, from the same code with no role branching.
export async function getRejectionReport() {
  const viewer = await getViewer();
  if (!viewer) return { rows: [], categorised: 0, uncategorised: 0 };
  return withViewer(viewer, async (tx) => {
    const grouped = await tx.application.groupBy({
      by: ["rejectionCategory"],
      where: { stage: "REJECTED" },
      _count: { _all: true },
    });
    return summariseRejections(
      grouped.map((g) => ({ category: g.rejectionCategory, count: g._count._all })),
    );
  });
}

// ── EEO export (M12) ─────────────────────────────────────────────────────────────────────────────

// May the viewer obtain UNSUPPRESSED demographic counts? A deliberately separate question from
// canReadEeo(): one asks "may you see the report", the other "may you see the exact numbers", and
// keeping them separate is what let the report widen to HR_GENERALIST without the filing following.
export async function canFileEeo() {
  const viewer = await getViewer();
  if (!viewer) return false;
  return withViewer(viewer, async (tx) => {
    const [row] = await tx.$queryRaw`SELECT app_can_file_eeo() AS ok`;
    return Boolean(row?.ok);
  });
}

// The EEO-1 cross-tab, exact. Returns null when the viewer may not file — the same
// "refused ≠ empty" distinction the summary makes, so the UI can say which it is.
//
// `uncategorisedJobs` is counted alongside, because a filing missing a category is a data-quality
// problem the person filing needs to see BEFORE they submit, not after a regulator asks.
export async function getEeoFiling() {
  const viewer = await getViewer();
  if (!viewer) return null;
  return withViewer(viewer, async (tx) => {
    const [gate] = await tx.$queryRaw`SELECT app_can_file_eeo() AS ok`;
    if (!gate?.ok) return null;

    const rows = await tx.$queryRaw`
      SELECT job_category, gender, ethnicity, headcount FROM app_eeo_filing()`;
    const uncategorisedJobs = await tx.job.count({ where: { eeoJobCategory: null } });

    return {
      rows: rows.map((r) => ({
        jobCategory: r.job_category,
        gender: r.gender,
        ethnicity: r.ethnicity,
        headcount: Number(r.headcount),
      })),
      uncategorisedJobs,
    };
  });
}

// Record that an export happened. INSERT-only by policy and by privilege — see the eeo_export
// migration — so this can add to the trail and nothing in the app can ever rewrite it.
export async function recordEeoExport({ variant, rowCount, uncategorisedJobs = 0 }) {
  const viewer = await getViewer();
  if (!viewer) return;
  await withViewer(viewer, (tx) =>
    tx.eeoExportLog.create({
      data: { variant, rowCount, uncategorisedJobs, orgId: viewer.orgId, actorId: viewer.userId },
    }),
  );
}

// The export trail, newest first.
//
// Actor names come from a plain `employee.findMany` here, NOT the app_org_chart directory the rest
// of this file uses. The directory exists because a RECRUITER has no employee-records access (the
// M5 lesson) — but this table is only readable by HR_ADMIN and HR_GENERALIST, and both are in
// ALL_RECORDS_ROLES, so for this audience the ordinary relation works and the workaround would be
// cargo-culting.
export async function getEeoExportHistory({ take = 10 } = {}) {
  const viewer = await getViewer();
  if (!viewer) return [];
  return withViewer(viewer, async (tx) => {
    const rows = await tx.eeoExportLog.findMany({
      orderBy: { exportedAt: "desc" },
      take,
      select: {
        id: true, variant: true, exportedAt: true, rowCount: true,
        uncategorisedJobs: true, actorId: true,
      },
    });
    if (rows.length === 0) return [];

    const people = await tx.employee.findMany({
      where: { userId: { in: rows.map((r) => r.actorId) } },
      select: { userId: true, firstName: true, lastName: true },
    });
    const byUserId = new Map(people.map((p) => [p.userId, `${p.firstName} ${p.lastName}`]));

    return rows.map((r) => ({ ...r, actorName: byUserId.get(r.actorId) ?? "\u2014" }));
  });
}
