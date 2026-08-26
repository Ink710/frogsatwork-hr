-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- M11 — SELF-SCHEDULE, EXACTLY ONCE
--
-- The requirement, parked since M5: a candidate may pick a time ONCE. A reschedule attempt is
-- refused and told to contact whoever is following up — no self-service reschedule.
--
-- M9 already built the enforcement: the claim is one atomic conditional UPDATE, and the unique index
-- on ("claimedByApplicationId", "roundId") makes "exactly once" a database constraint rather than a
-- promise made in application code. This migration adds only the two doorways the PORTAL needs.
--
-- ⚠️ WHY app_claim_interview_slot CANNOT BE CALLED FROM THE PORTAL DIRECTLY.
--
-- It takes (slot_id, application_id) and TRUSTS the application id — which was fine in M9, where the
-- only callers were staff behind app_can_manage_job. A candidate-facing action must never accept
-- one: the applicant would be naming the application they are booking for, and could name somebody
-- else's. So app_applicant_claim_slot DERIVES the application from the account, exactly like every
-- other applicant doorway in this app.
--
-- No schema change, no new table, no PII → app_erase_candidate is untouched.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

-- ── What this applicant may choose from ──────────────────────────────────────────────────────
--
-- Published, unclaimed, uncancelled slots whose (jobId, roundId) matches one of THIS account's
-- applications at the round it is currently in.
--
-- ⚠️ EXCLUDES ANY ROUND THE APPLICATION HAS ALREADY BOOKED. The claim would refuse it anyway with
-- ALREADY_BOOKED, but offering someone a choice that is going to be refused is a worse experience
-- than offering none — and it is the difference between the rule reading as a rule and reading as a
-- bug.
CREATE OR REPLACE FUNCTION app_applicant_available_slots(p_account_id text)
RETURNS TABLE (
  application_id text,
  job_title      text,
  round_name     text,
  slot_id        text,
  start_at       timestamp(3),
  end_at         timestamp(3),
  time_zone      text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, j.title, r.name, s.id, s."startAt", s."endAt", s."timeZone"
  FROM "CandidateAccount" acc
  JOIN "Candidate"        c ON c.id = acc."candidateId"
  JOIN "Application"      a ON a."candidateId" = c.id
  JOIN "InterviewSlot"    s ON s."jobId" = a."jobId" AND s."roundId" = a."currentRoundId"
  JOIN "InterviewRound"   r ON r.id = s."roundId"
  JOIN "Job"              j ON j.id = a."jobId"
  WHERE acc.id = p_account_id
    AND acc."closedAt" IS NULL
    AND c."anonymisedAt" IS NULL
    -- Interview rounds only exist while an application is AT the interview stage; currentRoundId is
    -- seeded on entry and cleared on exit, so this join already scopes to it. Stated anyway, because
    -- the rule matters more than the mechanism that happens to imply it.
    AND a.stage = 'INTERVIEW'
    AND s."publishedAt" IS NOT NULL
    AND s."claimedAt"   IS NULL
    AND s."cancelledAt" IS NULL
    -- Already booked this round? Then there is nothing to choose.
    AND NOT EXISTS (
      SELECT 1 FROM "InterviewSlot" mine
      WHERE mine."claimedByApplicationId" = a.id
        AND mine."roundId" = a."currentRoundId"
        AND mine."cancelledAt" IS NULL
    )
  ORDER BY s."startAt" ASC
$$;
GRANT EXECUTE ON FUNCTION app_applicant_available_slots(text) TO hris_app;

-- ── The candidate's claim ────────────────────────────────────────────────────────────────────
--
-- Same atomic conditional UPDATE as the staff path — one statement, zero rows meaning "someone got
-- there first" — but the application is DERIVED from the account rather than supplied.
--
-- Return codes are the caller's whole vocabulary:
--   OK              booked
--   ALREADY_BOOKED  this application already holds a slot for this round — the once-only rule
--   UNAVAILABLE     taken, cancelled, or never published (all mean "choose another")
--   NOT_ELIGIBLE    no application of this account's is at this slot's job+round
--   NOT_FOUND       no such slot, or the account cannot be used
CREATE OR REPLACE FUNCTION app_applicant_claim_slot(p_account_id text, p_slot_id text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_candidate_id text;
  v_slot         record;
  v_app_id       text;
  v_claimed      text;
BEGIN
  -- The same three guards every applicant doorway carries. Sessions are stateless JWTs, so this is
  -- the only place a closed account or an erased candidate can actually be refused.
  SELECT c.id INTO v_candidate_id
  FROM "CandidateAccount" acc
  JOIN "Candidate"        c ON c.id = acc."candidateId"
  WHERE acc.id = p_account_id
    AND acc."closedAt" IS NULL
    AND c."anonymisedAt" IS NULL;

  IF v_candidate_id IS NULL THEN
    RETURN 'NOT_FOUND';
  END IF;

  SELECT s.id, s."jobId", s."roundId" INTO v_slot
  FROM "InterviewSlot" s WHERE s.id = p_slot_id;

  IF v_slot.id IS NULL THEN
    RETURN 'NOT_FOUND';
  END IF;

  -- ⚠️ THE LINE THAT MAKES THIS SAFE. The application is found from the CANDIDATE and the slot —
  -- never accepted from the caller — so a valid slot id belonging to someone else's req matches no
  -- application of theirs and is refused. Knowing a slot id grants nothing.
  SELECT a.id INTO v_app_id
  FROM "Application" a
  WHERE a."candidateId" = v_candidate_id
    AND a."jobId" = v_slot."jobId"
    AND a."currentRoundId" = v_slot."roundId"
    AND a.stage = 'INTERVIEW';

  IF v_app_id IS NULL THEN
    RETURN 'NOT_ELIGIBLE';
  END IF;

  -- THE ONCE-ONLY RULE. The unique index would refuse the write anyway; answering here turns a
  -- constraint violation into a sentence a person can act on.
  IF EXISTS (
    SELECT 1 FROM "InterviewSlot" mine
    WHERE mine."claimedByApplicationId" = v_app_id
      AND mine."roundId" = v_slot."roundId"
      AND mine."cancelledAt" IS NULL
  ) THEN
    RETURN 'ALREADY_BOOKED';
  END IF;

  UPDATE "InterviewSlot"
     SET "claimedAt" = now(), "claimedByApplicationId" = v_app_id, "updatedAt" = now()
   WHERE id = p_slot_id
     AND "claimedAt"   IS NULL
     AND "cancelledAt" IS NULL
     AND "publishedAt" IS NOT NULL
  RETURNING id INTO v_claimed;

  -- Zero rows is NORMAL: another candidate won the race, or it was cancelled or unpublished between
  -- the page rendering and the click. All three mean the same thing to the person — choose another.
  IF v_claimed IS NULL THEN
    RETURN 'UNAVAILABLE';
  END IF;

  RETURN 'OK';
END;
$$;
GRANT EXECUTE ON FUNCTION app_applicant_claim_slot(text, text) TO hris_app;
