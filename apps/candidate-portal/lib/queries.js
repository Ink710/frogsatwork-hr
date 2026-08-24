import "server-only";
import { prisma } from "@hris/database";

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
