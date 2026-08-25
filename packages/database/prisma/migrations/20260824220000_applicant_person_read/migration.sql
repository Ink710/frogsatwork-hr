-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- M6 — the applicant reading their OWN name and contact details back.
--
-- ⚠️ WRITTEN BECAUSE THE OBVIOUS THING FAILED, FOR THE FOURTH TIME IN THIS PROJECT.
--
-- getMyProfile originally read the person with a plain
--     SELECT c."firstName" … FROM "CandidateAccount" a JOIN "Candidate" c ON c.id = a."candidateId"
-- which returns NOTHING. "CandidateAccount" has no RLS, but "Candidate" does — and the portal's
-- connection carries no session variables at all, so the join filter matches zero rows and the
-- prefill silently came back empty.
--
-- THE RULE, restated because it keeps being rediscovered: in the candidate portal, ANY read that
-- touches "Candidate" or "Application" must go through a SECURITY DEFINER doorway scoped by account
-- id. A join is not a way around RLS; it is a way to get an empty result and not notice.
--
-- Same three guards as every other applicant doorway: account must exist, not be closed, and the
-- candidate must not be erased.
-- ═════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION app_applicant_person(p_account_id text)
RETURNS TABLE (
  first_name text,
  last_name  text,
  email      text,
  phone      text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c."firstName", c."lastName", c.email, c.phone
  FROM "CandidateAccount" acc
  JOIN "Candidate"        c ON c.id = acc."candidateId"
  WHERE acc.id = p_account_id
    AND acc."closedAt" IS NULL
    AND c."anonymisedAt" IS NULL
$$;

GRANT EXECUTE ON FUNCTION app_applicant_person(text) TO hris_app;
