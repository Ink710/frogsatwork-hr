-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- M9 — INTERVIEW SCHEDULING: propose → confirm → publish → claim
--
-- `InterviewRound` was a NAME and an order. This is when the interview actually happens, with whom,
-- and who has taken it.
--
-- THE WORKFLOW, and why each step needs its own gate:
--   1. a RECRUITER proposes a time            → app_can_manage_job
--   2. the assigned INTERVIEWER confirms it   → app_can_confirm_interview_slot  ⚠️ see below
--   3. a recruiter PUBLISHES it               → app_can_manage_job
--   4. someone CLAIMS it                      → app_claim_interview_slot (atomic)
--
-- ⚠️ STEP 2 IS THE ONE THAT DOES NOT FIT THE ORDINARY POLICY. A JobMember with role INTERVIEWER can
-- app_can_see_job but NOT app_can_manage_job (that covers HR_ADMIN / RECRUITER / HIRING_MANAGER
-- only) — so the very person who must confirm cannot write to the row, and the workflow would be
-- impossible to complete. The codebase already solved this shape for scorecards: `scorecard_insert`
-- checks the acting employee id inside the policy, and app_can_edit_scorecard(id) gates an update on
-- "you are the author AND it is still DRAFT". This copies that rather than inventing anything.
--
-- ⚠️ STEP 4 IS A RACE, and that is what the shared pool costs. Two recruiters can assign from the
-- same pool (and in M11, two candidates can pick from it). The claim is therefore ONE conditional
-- UPDATE whose zero-rows result IS the "someone got there first" branch — never a read-then-write.
--
-- ERASURE IS NOT CHANGED, and that is a decision: this table has no free-text note, so it holds no
-- personal data. A claimed slot survives an erasure the way stages and ratings do.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

CREATE TABLE "InterviewSlot" (
  "id"                     text         NOT NULL,
  "startAt"                timestamp(3) NOT NULL,
  "endAt"                  timestamp(3) NOT NULL,
  "timeZone"               text         NOT NULL,
  "meetingUrl"             text,
  "confirmedAt"            timestamp(3),
  "publishedAt"            timestamp(3),
  "claimedAt"              timestamp(3),
  "cancelledAt"            timestamp(3),
  "createdAt"              timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"              timestamp(3) NOT NULL,
  "jobId"                  text         NOT NULL,
  "roundId"                text         NOT NULL,
  "interviewerEmployeeId"  text         NOT NULL,
  "proposedById"           text         NOT NULL,
  "claimedByApplicationId" text,
  CONSTRAINT "InterviewSlot_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "InterviewSlot" ADD CONSTRAINT "InterviewSlot_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InterviewSlot" ADD CONSTRAINT "InterviewSlot_roundId_fkey"
  FOREIGN KEY ("roundId") REFERENCES "InterviewRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InterviewSlot" ADD CONSTRAINT "InterviewSlot_interviewerEmployeeId_fkey"
  FOREIGN KEY ("interviewerEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InterviewSlot" ADD CONSTRAINT "InterviewSlot_proposedById_fkey"
  FOREIGN KEY ("proposedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InterviewSlot" ADD CONSTRAINT "InterviewSlot_claimedByApplicationId_fkey"
  FOREIGN KEY ("claimedByApplicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ⚠️ THE ONCE-PER-ROUND RULE, IN THE DATABASE. An application may hold one slot for round 1 AND one
-- for round 2, so the constraint is the PAIR — on the application alone it would block round 2
-- forever. Unclaimed slots have a NULL applicationId and Postgres treats NULLs as DISTINCT here, so
-- any number of them coexist, which is exactly right. (Contrast NotificationDelivery below, which
-- needs the opposite.) M11 leans on this: "you may pick exactly once" becomes a constraint rather
-- than a promise made in application code.
CREATE UNIQUE INDEX "InterviewSlot_claimedByApplicationId_roundId_key"
  ON "InterviewSlot"("claimedByApplicationId", "roundId");
CREATE INDEX "InterviewSlot_jobId_startAt_idx" ON "InterviewSlot"("jobId", "startAt");
CREATE INDEX "InterviewSlot_interviewerEmployeeId_idx" ON "InterviewSlot"("interviewerEmployeeId");

-- ── The confirm gate ─────────────────────────────────────────────────────────────────────────
-- Deliberately shaped like app_can_edit_scorecard: identity AND state, both checked in one place.
-- "It is mine to confirm, and it is still waiting for me."
CREATE OR REPLACE FUNCTION app_can_confirm_interview_slot(p_slot_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM "InterviewSlot" s
    WHERE s.id = p_slot_id
      AND s."interviewerEmployeeId" = current_setting('app.current_employee_id', true)
      AND s."cancelledAt" IS NULL
  )
$$;
GRANT EXECUTE ON FUNCTION app_can_confirm_interview_slot(text) TO hris_app;

-- ── RLS ──────────────────────────────────────────────────────────────────────────────────────
-- Read: anyone who can see the req, exactly like InterviewRound and Scorecard.
-- Write: whoever can manage it — EXCEPT confirming, which gets its own narrow UPDATE policy.
--
-- Both UPDATE policies coexist: Postgres ORs permissive policies of the same command, so a manager
-- passes via the first and the assigned interviewer via the second. The interviewer can ONLY reach
-- UPDATE — no INSERT, no DELETE — so they can confirm but never create or destroy a slot.
ALTER TABLE "InterviewSlot" ENABLE ROW LEVEL SECURITY;

CREATE POLICY interview_slot_read ON "InterviewSlot" FOR SELECT
  USING (app_can_see_job("jobId"));

CREATE POLICY interview_slot_manage ON "InterviewSlot" FOR ALL
  USING (app_can_manage_job("jobId"))
  WITH CHECK (app_can_manage_job("jobId"));

CREATE POLICY interview_slot_confirm ON "InterviewSlot" FOR UPDATE
  USING (app_can_confirm_interview_slot(id))
  WITH CHECK (app_can_confirm_interview_slot(id));

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- app_claim_interview_slot — the atomic claim.
--
-- ONE conditional UPDATE. Postgres locks the row for the statement, so of two simultaneous callers
-- exactly one gets a row back; the other gets zero and is told the slot is gone. There is no read,
-- no check-then-set, and therefore no window in between.
--
-- No "hold" or reservation: that solves a different problem (guaranteeing availability across a
-- multi-step commit), and picking a slot here is a single action. If M11 ever grows steps between
-- selecting and committing, `heldUntil` is a trivial ALTER at that point.
--
-- SECURITY DEFINER because M11 calls it for a CANDIDATE, who has no RLS identity at all. Staff use
-- the same doorway so there is one implementation of the race, not two.
-- ═════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION app_claim_interview_slot(p_slot_id text, p_application_id text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claimed text;
  v_round   text;
BEGIN
  SELECT s."roundId" INTO v_round FROM "InterviewSlot" s WHERE s.id = p_slot_id;
  IF v_round IS NULL THEN
    RETURN 'NOT_FOUND';
  END IF;

  -- Already holding a slot for this round? The unique index would refuse the insert anyway, but
  -- answering before the attempt turns a constraint violation into a message a person can act on.
  IF EXISTS (
    SELECT 1 FROM "InterviewSlot" s
    WHERE s."claimedByApplicationId" = p_application_id AND s."roundId" = v_round AND s.id <> p_slot_id
  ) THEN
    RETURN 'ALREADY_BOOKED';
  END IF;

  UPDATE "InterviewSlot"
     SET "claimedAt" = now(), "claimedByApplicationId" = p_application_id, "updatedAt" = now()
   WHERE id = p_slot_id
     AND "claimedAt"   IS NULL       -- nobody has it
     AND "cancelledAt" IS NULL       -- it still exists as an offer
     AND "publishedAt" IS NOT NULL   -- and it was actually published
  RETURNING id INTO v_claimed;

  -- Zero rows is a NORMAL outcome, not an error: someone else won the race, or it was never
  -- published, or it has been cancelled. All three mean "pick another time".
  IF v_claimed IS NULL THEN
    RETURN 'UNAVAILABLE';
  END IF;

  RETURN 'OK';
END;
$$;
GRANT EXECUTE ON FUNCTION app_claim_interview_slot(text, text) TO hris_app;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- app_applicant_interviews — what a signed-in applicant may see of their own scheduling.
--
-- The fifth doorway of this shape. "Application" and "InterviewSlot" are both under RLS and the
-- portal's connection carries no session variables, so a join returns nothing, silently — the trap
-- this project has now hit five times.
--
-- ⚠️ PUBLISHED ONLY, AND CLAIMED BY THIS APPLICATION ONLY. A proposed or merely confirmed slot is
-- internal: it must not leak a date to the person it concerns before anyone decided to offer it.
-- Same three account guards as every other applicant doorway.
--
-- Round NAME is returned (unlike app_applicant_events, which withholds it) because "Technical
-- interview, Tuesday 15:00" is what the applicant is actually attending — the M5 reasoning for
-- hiding round names was about not exposing the SHAPE of a pipeline they have not reached.
-- ═════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION app_applicant_interviews(p_account_id text)
RETURNS TABLE (
  application_id text,
  job_title      text,
  round_name     text,
  start_at       timestamp(3),
  end_at         timestamp(3),
  time_zone      text,
  meeting_url    text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, j.title, r.name, s."startAt", s."endAt", s."timeZone", s."meetingUrl"
  FROM "CandidateAccount" acc
  JOIN "Candidate"      c ON c.id = acc."candidateId"
  JOIN "Application"    a ON a."candidateId" = c.id
  JOIN "InterviewSlot"  s ON s."claimedByApplicationId" = a.id
  JOIN "InterviewRound" r ON r.id = s."roundId"
  JOIN "Job"            j ON j.id = a."jobId"
  WHERE acc.id = p_account_id
    AND acc."closedAt" IS NULL
    AND c."anonymisedAt" IS NULL
    AND s."publishedAt" IS NOT NULL
    AND s."cancelledAt" IS NULL
  ORDER BY s."startAt" ASC
$$;
GRANT EXECUTE ON FUNCTION app_applicant_interviews(text) TO hris_app;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- NotificationDelivery — widened to carry a SECOND kind of subject.
--
-- M8 keyed every delivery on an ApplicationEvent. M9 must tell an interviewer that a slot awaits
-- their confirmation, and that is not an event about an application.
--
-- Two real foreign keys with a CHECK that exactly one is set — not a `subjectType` + `subjectId`
-- pair, which would have no referential integrity and could not carry the denormalized owner column
-- every RLS policy here depends on.
--
-- ⚠️ THE UNIQUE INDEX MUST BE REBUILT TO INCLUDE THE NEW COLUMN, AND OMITTING IT WOULD BE SILENT.
-- The index is NULLS NOT DISTINCT, so a NULL compares EQUAL to a NULL. Every slot notification has
-- `applicationEventId IS NULL`, so without `interviewSlotId` in the key, two notifications about
-- DIFFERENT slots to the SAME interviewer both look like (NULL, 'EMAIL', user) — and the second
-- would be refused as an already-sent duplicate, with nothing erroring.
-- ═════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE "NotificationDelivery" ALTER COLUMN "applicationEventId" DROP NOT NULL;
ALTER TABLE "NotificationDelivery" ADD COLUMN "interviewSlotId" text;

ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_interviewSlotId_fkey"
  FOREIGN KEY ("interviewSlotId") REFERENCES "InterviewSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_one_subject"
  CHECK (num_nonnulls("applicationEventId", "interviewSlotId") = 1);

DROP INDEX "NotificationDelivery_event_channel_recipient_key";
CREATE UNIQUE INDEX "NotificationDelivery_subject_channel_recipient_key"
  ON "NotificationDelivery" ("applicationEventId", "interviewSlotId", "channel", "recipientUserId")
  NULLS NOT DISTINCT;

CREATE INDEX "NotificationDelivery_interviewSlotId_idx" ON "NotificationDelivery"("interviewSlotId");

-- app_claim_notification / app_mark_notification gain the slot subject. Same claim semantics as M8:
-- true only to the caller that won the row, and a FAILED row is re-claimable while a SENT one is not.
--
-- ⚠️ DROPPED FIRST, NOT `CREATE OR REPLACE`d. Adding a parameter — even a defaulted one — creates a
-- SECOND overload rather than replacing the function, and the existing two-argument call in
-- deliver.js would then match both and fail as ambiguous. Postgres refuses to choose. This is the
-- same trap M6 hit with app_submit_application, and it would NOT have shown up in a dry run: both
-- functions create cleanly, and the ambiguity only appears when something calls them.
DROP FUNCTION app_claim_notification(text, text, text);
DROP FUNCTION app_mark_notification(text, text, text, text);

CREATE FUNCTION app_claim_notification(
  p_event_id          text,
  p_channel           text,
  p_recipient_user_id text DEFAULT NULL,
  p_slot_id           text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_id  text;
  v_claimed text;
BEGIN
  -- Exactly one subject, resolved to the owner column the RLS policy reads. The caller never
  -- supplies a jobId it could get wrong.
  IF (p_event_id IS NULL) = (p_slot_id IS NULL) THEN
    RETURN false;
  END IF;

  IF p_event_id IS NOT NULL THEN
    SELECT e."jobId" INTO v_job_id FROM "ApplicationEvent" e WHERE e.id = p_event_id;
  ELSE
    SELECT s."jobId" INTO v_job_id FROM "InterviewSlot" s WHERE s.id = p_slot_id;
  END IF;

  IF v_job_id IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO "NotificationDelivery"
    (id, channel, status, "createdAt", "applicationEventId", "interviewSlotId", "jobId", "recipientUserId")
  VALUES
    (gen_random_uuid()::text, p_channel::"NotificationChannel", 'PENDING', now(),
     p_event_id, p_slot_id, v_job_id, p_recipient_user_id)
  ON CONFLICT ("applicationEventId", "interviewSlotId", "channel", "recipientUserId") DO UPDATE
    SET status = 'PENDING', "attemptedAt" = NULL
    WHERE "NotificationDelivery".status = 'FAILED'
  RETURNING id INTO v_claimed;

  RETURN v_claimed IS NOT NULL;
END;
$$;

CREATE FUNCTION app_mark_notification(
  p_event_id          text,
  p_channel           text,
  p_status            text,
  p_recipient_user_id text DEFAULT NULL,
  p_slot_id           text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer;
BEGIN
  -- `IS NOT DISTINCT FROM` throughout, not `=`: the recipient is normally NULL and so is whichever
  -- subject is unused, and `NULL = NULL` is NULL — an equality test would match nothing and every
  -- send would stay PENDING forever.
  UPDATE "NotificationDelivery"
     SET status = p_status::"NotificationStatus", "attemptedAt" = now()
   WHERE "applicationEventId" IS NOT DISTINCT FROM p_event_id
     AND "interviewSlotId"    IS NOT DISTINCT FROM p_slot_id
     AND channel = p_channel::"NotificationChannel"
     AND "recipientUserId"    IS NOT DISTINCT FROM p_recipient_user_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION app_claim_notification(text, text, text, text) TO hris_app;
GRANT EXECUTE ON FUNCTION app_mark_notification(text, text, text, text, text) TO hris_app;
