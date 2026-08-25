-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- M9 follow-up — TWO BUGS THE INTEGRATION TESTS FOUND, both in the previous migration.
--
-- ⚠️ (1) THE TWO-PERSON RULE DID NOT HOLD AT THE DATABASE.
--
-- `interview_slot_confirm` correctly restricted confirmation to the assigned interviewer — but
-- `interview_slot_manage` is FOR ALL, and **permissive policies of the same command are OR'd
-- together**. So a recruiter passed via the manage policy and could set `confirmedAt` on a slot
-- nobody had agreed to sit in, which is precisely the thing the workflow exists to prevent. A test
-- asserting "the recruiter who proposed it cannot confirm it" failed, and it was right to.
--
-- RLS cannot express "everything except this column", so the fix is column-level privilege plus a
-- doorway — the same split the suite already uses for the audit log and ApplicationAnswer:
--   · REVOKE UPDATE("confirmedAt") from the app role, so NO ordinary statement can set it;
--   · app_confirm_interview_slot(), SECURITY DEFINER, which checks the caller IS the interviewer.
-- The old policy becomes inert and is dropped rather than left to imply a guarantee it never gave.
--
-- ⚠️ (2) THE INTERVIEWER NOTIFICATION SILENTLY SENT NOTHING.
--
-- proposeSlot read the interviewer with `tx.employee.findFirst` under the RECRUITER's viewer.
-- "Employee" is RLS'd by app_can_see_employee — a recruiter is not a manager, so the row came back
-- null, the email was skipped, and nothing errored. This is the trap getJobForManage already
-- documents for names (which it resolves via app_org_chart); the address and linked user id need
-- their own doorway because the org chart carries neither.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

DROP POLICY interview_slot_confirm ON "InterviewSlot";

-- No ordinary UPDATE may touch this column any more, whoever the caller is. The doorway below runs
-- as the owner and is therefore unaffected — that asymmetry IS the enforcement.
REVOKE UPDATE ("confirmedAt") ON "InterviewSlot" FROM hris_app;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- app_confirm_interview_slot — the assigned interviewer agrees to sit in it.
--
-- Identity AND state in one place, exactly like app_can_edit_scorecard: it is mine to confirm, and
-- it is still waiting for me. A recruiter calling this is refused however much they can otherwise
-- manage the req.
-- ═════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION app_confirm_interview_slot(p_slot_id text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me   text := NULLIF(current_setting('app.current_employee_id', true), '');
  v_slot record;
BEGIN
  IF v_me IS NULL THEN
    RETURN 'NOT_YOURS';
  END IF;

  SELECT s.id, s."interviewerEmployeeId", s."confirmedAt", s."cancelledAt"
    INTO v_slot
  FROM "InterviewSlot" s
  WHERE s.id = p_slot_id;

  IF v_slot.id IS NULL THEN
    RETURN 'NOT_FOUND';
  END IF;

  -- One answer for "not yours" and "already handled": the caller is staff, so there is nothing to
  -- probe, but there is also nothing useful to distinguish — either way it is not theirs to do now.
  IF v_slot."interviewerEmployeeId" IS DISTINCT FROM v_me
     OR v_slot."cancelledAt" IS NOT NULL
     OR v_slot."confirmedAt" IS NOT NULL THEN
    RETURN 'NOT_YOURS';
  END IF;

  UPDATE "InterviewSlot" SET "confirmedAt" = now(), "updatedAt" = now() WHERE id = p_slot_id;
  RETURN 'OK';
END;
$$;
GRANT EXECUTE ON FUNCTION app_confirm_interview_slot(text) TO hris_app;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- app_interview_slot_recipient — who to notify about a proposed slot, and what to tell them.
--
-- Exists because the interviewer's own Employee row is invisible to the recruiter proposing the
-- time. Returns only what the message needs: a name, an address, the linked user id (the delivery
-- record's recipient), and the two labels that make the email intelligible.
-- ═════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION app_interview_slot_recipient(p_slot_id text)
RETURNS TABLE (
  user_id    text,
  email      text,
  first_name text,
  job_title  text,
  round_name text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e."userId", e.email, e."firstName", j.title, r.name
  FROM "InterviewSlot"   s
  JOIN "Employee"        e ON e.id = s."interviewerEmployeeId"
  JOIN "Job"             j ON j.id = s."jobId"
  JOIN "InterviewRound"  r ON r.id = s."roundId"
  WHERE s.id = p_slot_id
    AND e."userId" IS NOT NULL
$$;
GRANT EXECUTE ON FUNCTION app_interview_slot_recipient(text) TO hris_app;
