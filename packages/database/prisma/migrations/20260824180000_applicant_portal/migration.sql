-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- M5 — THE APPLICANT'S READ PATH.
--
-- WHY DOORWAYS RATHER THAN RLS, restated because this is the milestone where it matters most.
-- Adding a "self" branch to candidate_visibility / app_can_see_job would touch policies that gate
-- EVERY candidate and job read in the ATS, and both are already evaluated once per row SCANNED. A
-- pair of SECURITY DEFINER functions changes nothing for staff, and makes the applicant's entire
-- surface reviewable in one place: whatever these two SELECT is exactly what an applicant can ever
-- see, because the app does no widening of its own.
--
-- ⚠️ WHAT IS DELIBERATELY NOT SELECTED, and must never be added:
--   • ApplicationEvent.note      — internal prose about a person. app_erase_candidate BLANKS it,
--                                  which is the clearest possible statement that it is PII.
--   • ApplicationEvent.roundName — describes OUR process ("System Design"), not their progress.
--   • ApplicationEvent.actorId   — which employee moved them, and when. None of an applicant's
--                                  business, and a name we would be publishing to the internet.
--   • Application.rejectionReason / rejectionCategory — the outcome is shown; the internal
--                                  judgement is not (see the M5 plan for the reasoning).
-- Leaking any of these would take an edit HERE, which is the point of putting the projection in one
-- reviewable place rather than trusting every future page not to over-select.
--
-- ⚠️ BOTH FUNCTIONS RE-CHECK `closedAt`, AND THAT IS LOAD-BEARING, NOT BELT-AND-BRACES.
-- Sessions in this suite are JWTs: nothing is looked up per request, so a session issued BEFORE an
-- account was closed stays cryptographically valid until it expires. Closing an account on hire
-- (app_link_hire) therefore stops future logins but CANNOT reach an already-issued cookie. The only
-- place revocation can actually bite is the data layer — here. Remove these checks and a hired
-- person keeps reading their interview history from a public site until their cookie ages out.
--
-- The same applies to an ERASED candidate: their account row is deleted, so the join finds nothing,
-- but the anonymisedAt check states the intent rather than relying on that side effect.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION app_applicant_applications(p_account_id text)
RETURNS TABLE (
  application_id text,
  job_title      text,
  job_location   text,
  applied_at     timestamp(3),
  stage          text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, j.title, j.location, a."appliedAt", a.stage::text
  FROM "CandidateAccount" acc
  JOIN "Candidate"        c ON c.id = acc."candidateId"
  JOIN "Application"      a ON a."candidateId" = c.id
  JOIN "Job"              j ON j.id = a."jobId"
  WHERE acc.id = p_account_id
    AND acc."closedAt" IS NULL
    AND c."anonymisedAt" IS NULL
  ORDER BY a."appliedAt" DESC
$$;

-- The timeline for EVERY application this account owns, in one call rather than one per
-- application. The page groups them by application_id; two round trips total, no N+1.
CREATE OR REPLACE FUNCTION app_applicant_events(p_account_id text)
RETURNS TABLE (
  application_id text,
  to_stage       text,
  occurred_at    timestamp(3)
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e."applicationId", e."toStage"::text, e."occurredAt"
  FROM "CandidateAccount"  acc
  JOIN "Candidate"         c ON c.id = acc."candidateId"
  JOIN "Application"       a ON a."candidateId" = c.id
  JOIN "ApplicationEvent"  e ON e."applicationId" = a.id
  WHERE acc.id = p_account_id
    AND acc."closedAt" IS NULL
    AND c."anonymisedAt" IS NULL
  ORDER BY e."occurredAt" ASC, e.id ASC
$$;

GRANT EXECUTE ON FUNCTION app_applicant_applications(text) TO hris_app;
GRANT EXECUTE ON FUNCTION app_applicant_events(text)       TO hris_app;
