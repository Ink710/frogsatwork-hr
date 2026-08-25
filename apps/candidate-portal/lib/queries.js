import "server-only";
import { prisma } from "@hris/database";
import { publicStatusFor, buildApplicantTimeline } from "@hris/recruiting";

// The PUBLIC read path. Every function here runs with a BARE prisma client and no `withViewer`,
// because there is no viewer — the caller is an anonymous stranger on the internet.
//
// That is safe for exactly one reason: `app_public_jobs()` is a SECURITY DEFINER function whose
// projection IS the security boundary. It returns only reqs that are OPEN *and* published, and only
// the columns a stranger may read — no openings count, no hiring team, no department, no orgId, no
// application data. Nothing here filters; the function has already decided.
//
// ⚠️ Anything added to this file must go through a doorway of that kind, or through RLS with a real
// viewer. A bare `prisma.<model>.findMany()` here would run as hris_app with NO session variables
// set, which is not "everything" — RLS would narrow it to nothing — but it is still the wrong shape,
// and the day someone adds a table without RLS it becomes a leak. Keep the discipline explicit.

export async function getPublishedJobs() {
  return prisma.$queryRaw`
    SELECT id, title, location, "employmentType"::text AS "employmentType", "publishedAt",
           "salaryMin"::text AS "salaryMin", "salaryMax"::text AS "salaryMax",
           currency, "payBasis"::text AS "payBasis"
    FROM app_public_jobs()
    ORDER BY "publishedAt" DESC, title ASC`;
}

// One public posting, or null. Same boundary; also returns the description for the detail page.
// Returning null (rather than throwing) is what lets the page call notFound() — so guessing the id
// of a draft, paused or confidential req is indistinguishable from guessing a nonexistent one.
export async function getPublishedJob(jobId) {
  const [row] = await prisma.$queryRaw`
    SELECT id, title, description, location, "employmentType"::text AS "employmentType", "publishedAt",
           "salaryMin"::text AS "salaryMin", "salaryMax"::text AS "salaryMax",
           currency, "payBasis"::text AS "payBasis"
    FROM app_public_jobs() WHERE id = ${jobId}`;
  return row ?? null;
}

// ---------------------------------------------------------------------------
// The APPLICANT's own data (M5).
// ---------------------------------------------------------------------------

/**
 * Everything the signed-in applicant may see about their own applications.
 *
 * Two doorway calls, not N+1: one for the applications, one for every event across them. Bare
 * `prisma` again — "Candidate" and "Application" are under RLS and this connection has no session
 * variables, so these MUST go through the SECURITY DEFINER functions, which scope by account id.
 *
 * ⚠️ THE MAPPING HAPPENS HERE, BEFORE ANYTHING IS RETURNED. Nothing above this line hands a raw
 * `stage` to a component, so an internal value cannot end up in the RSC payload by someone later
 * spreading a row into props. The doorway limits what may be READ; this limits what is even
 * REPRESENTABLE upstream.
 */
export async function getMyApplications(accountId) {
  if (!accountId) return [];

  const [applications, events] = await Promise.all([
    prisma.$queryRaw`
      SELECT application_id, job_title, job_location, applied_at, stage
      FROM app_applicant_applications(${accountId})`,
    prisma.$queryRaw`
      SELECT application_id, to_stage, occurred_at
      FROM app_applicant_events(${accountId})`,
  ]);

  const eventsByApplication = new Map();
  for (const e of events) {
    const list = eventsByApplication.get(e.application_id) ?? [];
    list.push({ toStage: e.to_stage, occurredAt: e.occurred_at });
    eventsByApplication.set(e.application_id, list);
  }

  return applications.map((a) => {
    const status = publicStatusFor(a.stage);
    return {
      id: a.application_id,
      jobTitle: a.job_title,
      jobLocation: a.job_location,
      appliedAt: a.applied_at,
      // Only the i18n KEY and the two flags travel onwards — never `a.stage` itself.
      statusKey: status.key,
      terminal: status.terminal,
      closingMessage: status.closingMessage,
      timeline: buildApplicantTimeline(eventsByApplication.get(a.application_id) ?? []),
    };
  });
}
