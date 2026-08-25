-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- M6 — the applicant reading their OWN profile back.
--
-- Needed because the profile tables are governed by app_can_see_candidate(), which answers "are you
-- STAFF who may see this candidate". An applicant is not staff and has no session variables at all,
-- so a bare read returns nothing — the same wall M5's timeline hit. Same answer: a doorway scoped by
-- account id.
--
-- This is what makes a second application quick, which was the whole argument for keeping a profile
-- separate from the per-application snapshot.
--
-- Refuses a closed account and an erased candidate for the reason M5 documents at length: sessions
-- are JWTs, so the data layer is the only place revocation can actually bite.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION app_applicant_employment(p_account_id text)
RETURNS TABLE (
  employer   text,
  title      text,
  start_date timestamp(3),
  end_date   timestamp(3),
  summary    text,
  -- `sort_order`, not `position`: POSITION is a reserved word in Postgres (the POSITION(x IN y)
  -- function), so a bare `position integer` in a RETURNS TABLE is a syntax error.
  sort_order integer
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.employer, e.title, e."startDate", e."endDate", e.summary, e.position
  FROM "CandidateAccount"     acc
  JOIN "Candidate"            c ON c.id = acc."candidateId"
  JOIN "CandidateEmployment"  e ON e."candidateId" = c.id
  WHERE acc.id = p_account_id
    AND acc."closedAt" IS NULL
    AND c."anonymisedAt" IS NULL
  ORDER BY e.position ASC
$$;

CREATE OR REPLACE FUNCTION app_applicant_education(p_account_id text)
RETURNS TABLE (
  institution   text,
  qualification text,
  start_date    timestamp(3),
  end_date      timestamp(3),
  sort_order    integer
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ed.institution, ed.qualification, ed."startDate", ed."endDate", ed.position
  FROM "CandidateAccount"    acc
  JOIN "Candidate"           c  ON c.id = acc."candidateId"
  JOIN "CandidateEducation"  ed ON ed."candidateId" = c.id
  WHERE acc.id = p_account_id
    AND acc."closedAt" IS NULL
    AND c."anonymisedAt" IS NULL
  ORDER BY ed.position ASC
$$;

GRANT EXECUTE ON FUNCTION app_applicant_employment(text) TO hris_app;
GRANT EXECUTE ON FUNCTION app_applicant_education(text)  TO hris_app;
