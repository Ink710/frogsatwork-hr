-- The READ half of the public careers site.
--
-- `Job` has RLS enabled and `job_read` delegates to app_can_see_job(), which is driven by the
-- app.current_* session variables. An anonymous visitor has none, so a normal SELECT correctly
-- returns nothing. Rather than punch a hole in that policy (e.g. "…OR the job is published"), which
-- would widen the surface for every authenticated query too, the public site gets its own narrow
-- SECURITY DEFINER view-function — the mirror of app_submit_application on the write side.
--
-- It exposes ONLY advertised postings (OPEN + published) and ONLY the columns a careers page needs.
-- Nothing internal — no openings count, no department, no hiring team, no applications — can leak
-- through it, because those columns simply aren't in the result.
CREATE OR REPLACE FUNCTION app_public_jobs()
RETURNS TABLE (
  id text,
  title text,
  description text,
  location text,
  "employmentType" "EmploymentType",
  "publishedAt" timestamp(3)
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT j.id, j.title, j.description, j.location, j."employmentType", j."publishedAt"
  FROM "Job" j
  WHERE j.status = 'OPEN' AND j."publishedAt" IS NOT NULL
$$;

GRANT EXECUTE ON FUNCTION app_public_jobs() TO hris_app;
