-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- M15 — an INTERVIEWER may only OPEN feedback while the candidate is at the INTERVIEW stage.
--
-- THE ARGUMENT. M7 already stops an interviewer reading colleagues' feedback before filing their
-- own, because knowing what everyone else thought contaminates what you write. The same
-- contamination arrives more slowly through the pipeline itself: a scorecard written after the offer
-- went out is not evidence of what the interviewer observed, it is agreement with a decision that
-- has already been made. Feedback written before the interview has the same problem pointing the
-- other way. So the window for STARTING feedback is exactly the window in which the interview is the
-- live question.
--
-- ⚠️ RECRUITERS AND HIRING MANAGERS ARE DELIBERATELY EXEMPT. They run the process and legitimately
-- record late debrief notes; the interviewer is the person whose independence this protects. The
-- exemption is written as `app_can_manage_job` rather than by naming a role, because the only
-- hiring-team members who are NOT managers are interviewers — so the capability already describes
-- the population exactly, and it stays consistent with every other gate in the ATS.
--
-- ⚠️⚠️ WHY UPDATE IS UNTOUCHED, AND WHY THAT IS NOT THE GAP IT LOOKS LIKE.
-- The obvious implementation gates every write on the stage. That version is wrong in practice, and
-- badly: an interviewer opens a draft during the interview, the recruiter advances the candidate
-- that afternoon, and the next morning the draft can never be submitted. Their feedback never
-- reaches the debrief, the M9 interviewer-load report undercounts them, and — worst — M7's
-- `app_can_see_scorecard` only unlocks colleagues' feedback to someone with a SUBMITTED card on that
-- application, so a stranded draft locks that interviewer out of the debrief for that candidate
-- PERMANENTLY. The rule would punish the one person who did the work on time.
--
-- So the rule is about STARTING, not touching. And that needs no clause at all, because of a
-- property this schema already has:
--
--     if INSERT is stage-gated, then every existing DRAFT was necessarily created at INTERVIEW.
--
-- `app_can_edit_scorecard` (author + status = DRAFT) therefore stays EXACTLY as M7 wrote it, and
-- `scorecard_rating_write`, which inherits from it, needs nothing either. "You may finish what you
-- started" is not an extra rule bolted on — it is what the UPDATE policy has always said, once
-- INSERT is the gate. Do not "fix" the apparent asymmetry below; it is the whole design.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

-- May the caller OPEN new feedback on this application?
--
-- SECURITY DEFINER is required, not stylistic: it reads "Application", which is itself RLS'd, and a
-- policy that consulted it through the caller's own visibility would answer a different question
-- (and, for the INSERT path, could not see what it needed).
CREATE OR REPLACE FUNCTION app_can_start_feedback(p_application_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM "Application" a
    WHERE a.id = p_application_id
      AND (
        a.stage = 'INTERVIEW'
        -- Recruiters and hiring managers are unaffected — see the note above.
        OR app_can_manage_job(a."jobId")
      )
  )
$$;

GRANT EXECUTE ON FUNCTION app_can_start_feedback(text) TO hris_app;

-- Recreate the INSERT policy with the stage condition. The other two conditions are M7's, verbatim:
-- authorship is judged against the NEW ROW'S OWN COLUMN (the M5 lesson — a lookup-based check cannot
-- see a row mid-insert), and team membership through app_can_see_job.
--
-- The new condition DOES look a row up, but in a DIFFERENT table ("Application"), which already
-- exists at this point — so the mid-insert trap does not apply here.
DROP POLICY IF EXISTS scorecard_insert ON "Scorecard";
CREATE POLICY scorecard_insert ON "Scorecard" FOR INSERT
  WITH CHECK (
    "authorEmployeeId" = current_setting('app.current_employee_id', true)
    AND app_can_see_job("jobId")
    AND app_can_start_feedback("applicationId")
  );
