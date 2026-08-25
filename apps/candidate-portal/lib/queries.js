import "server-only";
import { prisma } from "@hris/database";
import { publicStatusFor, buildApplicantTimeline, dateToMonth } from "@hris/recruiting";

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

/**
 * The screening questions a job asks (M6b) — public, for the apply form.
 *
 * Doorway again: "JobQuestion" is gated by app_can_see_job ("are you on this hiring team"), so an
 * applicant reads nothing directly. app_public_job_questions applies the same OPEN+published gate as
 * app_public_jobs, so an unadvertised req's questions are as invisible as the req, and archived
 * questions are excluded — they exist to explain old answers, not to be asked again.
 */
export async function getJobQuestions(jobId) {
  return prisma.$queryRaw`
    SELECT id, prompt, type, required, options FROM app_public_job_questions(${jobId})`;
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
    const timeline = buildApplicantTimeline(eventsByApplication.get(a.application_id) ?? []);
    return {
      id: a.application_id,
      jobTitle: a.job_title,
      jobLocation: a.job_location,
      appliedAt: a.applied_at,
      // Only the i18n KEY and the two flags travel onwards — never `a.stage` itself.
      statusKey: status.key,
      terminal: status.terminal,
      closingMessage: status.closingMessage,
      timeline,
      // M8's in-portal notification, and it needs NO new storage: the most recent thing that
      // happened, which the event trail already says. There is no read state by design — a banner
      // that always shows the latest move is honest without inventing "unread", which would mean
      // candidate-side writes and a table to hold them.
      //
      // Null when APPLIED is the only entry: the card already says "Applied", and a banner
      // announcing the thing they just did themselves is noise.
      latestUpdate: timeline.length > 1 ? timeline[timeline.length - 1] : null,
    };
  });
}

/**
 * The signed-in applicant's PROFILE, for prefilling the apply form.
 *
 * Through doorways again: CandidateEmployment / CandidateEducation are governed by
 * app_can_see_candidate(), which asks "are you STAFF who may see this candidate" — an applicant is
 * not, and has no session variables at all, so a bare read returns nothing.
 *
 * Dates come back as timestamps and are converted to the YYYY-MM the form's month inputs use.
 */
/**
 * The interviews this applicant actually has (M9).
 *
 * Doorway again — the fifth of this shape. "Application" and "InterviewSlot" are both under RLS and
 * this connection has no session variables, so a join returns nothing, silently.
 *
 * ⚠️ The doorway returns PUBLISHED, CLAIMED-BY-THEM slots only. A proposed or merely confirmed time
 * is internal: it must not reach the person it concerns before anyone decided to offer it.
 *
 * The canonical `timeZone` travels with each row, because "15:00" alone is not a time to someone
 * whose own zone we do not know.
 */
export async function getMyInterviews(accountId) {
  if (!accountId) return new Map();
  const rows = await prisma.$queryRaw`
    SELECT application_id, round_name, start_at, end_at, time_zone, meeting_url
    FROM app_applicant_interviews(${accountId})`;

  // Keyed by application so the portal card can show its own interview without a second pass.
  const byApplication = new Map();
  for (const r of rows) {
    const list = byApplication.get(r.application_id) ?? [];
    list.push({
      roundName: r.round_name,
      startAt: r.start_at,
      endAt: r.end_at,
      timeZone: r.time_zone,
      meetingUrl: r.meeting_url,
    });
    byApplication.set(r.application_id, list);
  }
  return byApplication;
}

/**
 * The CV currently on the applicant's profile (M7) — the editor's "on file" line, and the only
 * thing `/portal/resume` needs in order to stream it.
 *
 * Returns `{ key, fileName }` or null.
 *
 * ⚠️ THE KEY IS FOR SERVER USE ONLY — `/portal/resume` resolves the file with it. It must NOT be
 * handed to a client component: every prop is serialized into the RSC payload and readable in the
 * page source, so passing this object whole publishes a path into the private store. The profile
 * page passes `resume?.fileName` alone for exactly that reason.
 *
 * This comment used to claim the key "never reaches a component". It did — the browser check found
 * it in the payload, and no test could have, because tests do not render. Callers must strip it;
 * the type does not do it for them.
 */
export async function getMyResume(accountId) {
  if (!accountId) return null;
  const [row] = await prisma.$queryRaw`
    SELECT resume_key, resume_file_name FROM app_applicant_resume(${accountId})`;
  if (!row?.resume_key) return null;
  return { key: row.resume_key, fileName: row.resume_file_name ?? "resume" };
}

export async function getMyProfile(accountId) {
  if (!accountId) return null;

  const [candidate, employment, education] = await Promise.all([
    // ⚠️ Through a doorway, NOT a join. "Candidate" is under RLS and this connection has no session
    // variables, so `JOIN "Candidate"` matches zero rows and the prefill comes back silently empty.
    // (Exactly what the first version of this did.)
    prisma.$queryRaw`
      SELECT first_name, last_name, email, phone FROM app_applicant_person(${accountId})`,
    prisma.$queryRaw`
      SELECT employer, title, start_date, end_date, summary FROM app_applicant_employment(${accountId})`,
    prisma.$queryRaw`
      SELECT institution, qualification, start_date, end_date FROM app_applicant_education(${accountId})`,
  ]);

  const person = candidate[0];
  if (!person) return null;

  return {
    firstName: person.first_name,
    lastName: person.last_name,
    email: person.email,
    phone: person.phone ?? "",
    employment: employment.map((e) => ({
      employer: e.employer,
      title: e.title,
      startDate: dateToMonth(e.start_date),
      endDate: dateToMonth(e.end_date),
      summary: e.summary ?? "",
    })),
    education: education.map((e) => ({
      institution: e.institution,
      qualification: e.qualification,
      startDate: dateToMonth(e.start_date),
      endDate: dateToMonth(e.end_date),
    })),
  };
}
