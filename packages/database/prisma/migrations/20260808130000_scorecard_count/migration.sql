-- How many scorecards have been SUBMITTED on an application, regardless of who may read them.
--
-- Why this exists: the anchoring guard (app_can_see_scorecard) correctly hides colleagues' feedback
-- until you've submitted your own — but a UI that just shows fewer rows reads as "nobody has
-- reviewed yet", which is false and confusing. The debrief screen instead says "2 colleagues have
-- submitted — submit yours to read them". That needs a COUNT the caller isn't otherwise allowed to
-- derive, so it goes through a SECURITY DEFINER function that returns exactly one integer and
-- nothing else: no names, no ratings, no recommendations.
--
-- It is still gated: you only get a number if you're on that job's hiring team. Without this check
-- the function would be an oracle for probing activity on any application in any org.
CREATE OR REPLACE FUNCTION app_submitted_scorecard_count(p_application_id text)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM "Application" a
      WHERE a.id = p_application_id AND app_can_see_job(a."jobId")
    )
    THEN (
      SELECT count(*)::integer FROM "Scorecard" s
      WHERE s."applicationId" = p_application_id AND s.status = 'SUBMITTED'
    )
    ELSE 0
  END
$$;

GRANT EXECUTE ON FUNCTION app_submitted_scorecard_count(text) TO hris_app;
