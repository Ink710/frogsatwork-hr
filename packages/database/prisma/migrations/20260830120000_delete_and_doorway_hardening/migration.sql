-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- M14 — HARDENING. Three things the code happened to do correctly with nothing stopping it from
-- stopping. All three came out of a pre-deploy audit; the third is a real bug, not a tightening.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

-- ── 1. "NEVER HARD-DELETE AN EMPLOYEE" BECOMES A PRIVILEGE, NOT A CONVENTION ─────────────────
--
-- The headline domain rule is that these records are retained: terminations are a status change,
-- candidate erasure ANONYMISES, and history is append-only. But `hris_app` held DELETE on all four
-- tables and their policies are FOR ALL, so one stray `prisma.employee.delete()` would have worked.
--
-- ⚠️ THE PATTERN IS ALREADY HERE — this only extends it. `EmployeeAuditLog` and `ApplicationEvent`
-- are append-only precisely because an INSERT/SELECT-only GRANT makes their FOR ALL policy moot.
-- RLS cannot express "everything except DELETE"; the privilege can.
--
-- Verified before writing, and both halves matter:
--   · NO application code deletes any of these four — only child/join rows (rounds, competencies,
--     job members, ratings, budgets, time entries, shifts, assignments).
--   · NO foreign key CASCADES into them. Every FK they participate in is RESTRICT or SET NULL, so
--     no permitted delete elsewhere can reach them through a referential action. (Application→Job
--     and Application→Candidate are RESTRICT — already why a req with applications is undeletable.)
--
-- SECURITY DEFINER doorways are unaffected: they run as the table owner, so app_erase_candidate
-- still deletes the profile rows and answers it is meant to.
REVOKE DELETE ON "Employee"        FROM hris_app;
REVOKE DELETE ON "EmployeeHistory" FROM hris_app;
REVOKE DELETE ON "Candidate"       FROM hris_app;
REVOKE DELETE ON "Application"     FROM hris_app;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠️⚠️ 2. THE ROLE GUARD THAT DID NOT FIRE FOR AN UNAUTHENTICATED CALLER
--
-- THIS IS THE ONE THAT WAS ACTUALLY BROKEN, and it is a SQL NULL trap:
--
--     current_setting('app.current_role', true)   -- NULL when the GUC was never SET
--     NULL NOT IN ('HR_ADMIN', …)                 -- → NULL, which is NOT TRUE
--     IF NULL THEN …                              -- → branch NOT taken → guard SKIPPED
--
-- So `app_link_hire` refused a signed-in RECRUITER but let through a connection that had never
-- identified itself at all — exactly inverted. Proven before the fix: called with no session vars
-- it returned NOT_HIRED, a check that sits BELOW the role gate, so it had already passed it.
--
-- Not exploitable through the apps today, because every authenticated path goes through withViewer
-- (which always sets the GUCs) and nothing calls app_link_hire from an unauthenticated path. But
-- the PUBLIC surfaces — the apply flow, the careers page, the portal doorways — deliberately use a
-- bare prisma client with NO session vars, so "no role set" is a real, reachable state in this
-- codebase rather than a theoretical one. That is what makes this worth fixing rather than noting.
--
-- coalesce(..., '') makes the comparison total: an unset role becomes the empty string, which is
-- not in the list, so the guard fires. Applied to BOTH functions that use this construct — there
-- are exactly two, found with:
--   SELECT proname FROM pg_proc WHERE prosrc ~ 'current_setting\(''app\.current_role''.*\)\s*NOT IN';
--
-- ⚠️ app_link_hire below is the LIVE definition dumped with pg_get_functiondef and patched at the
-- guard ONLY — never retyped. Retyping is how M4 silently dropped three columns from
-- app_erase_candidate. Note pg_get_functiondef emits NO trailing semicolon (the M6 trap).
-- ═════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.app_link_hire(p_application_id text, p_employee_id text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_stage        "ApplicationStage";
  v_job_id       text;
  v_existing     text;
  v_org_id       text;
  v_openings     integer;
  v_hires        integer;
  v_candidate_id text;
BEGIN
  -- Onboarding belongs to whoever owns employee records — NOT to recruiters.
  -- ⚠️ COALESCE IS THE FIX, NOT A TIDY-UP (M14). `current_setting(..., true)` returns NULL when the
  -- GUC is unset, and `NULL NOT IN (...)` is NULL, not TRUE — so this IF did not fire and the guard
  -- was SKIPPED ENTIRELY for a caller with no session role. It refused a signed-in RECRUITER while
  -- waving through a connection that had never identified itself, which is precisely backwards.
  -- Proven before the fix: with no session vars this function returned NOT_HIRED — a LATER business
  -- check — meaning it had already passed this one.
  IF coalesce(current_setting('app.current_role', true), '') NOT IN ('HR_ADMIN', 'HR_GENERALIST', 'SYSTEM') THEN
    RETURN 'FORBIDDEN';
  END IF;

  SELECT a.stage, a."jobId", a."hiredEmployeeId", a."orgId", a."candidateId"
    INTO v_stage, v_job_id, v_existing, v_org_id, v_candidate_id
  FROM "Application" a WHERE a.id = p_application_id;

  IF v_job_id IS NULL THEN RETURN 'NOT_FOUND'; END IF;
  -- Same-tenant check: the employee must belong to the application's org.
  IF NOT EXISTS (SELECT 1 FROM "Employee" e WHERE e.id = p_employee_id AND e."orgId" = v_org_id) THEN
    RETURN 'NOT_FOUND';
  END IF;
  -- Reaching HIRED is the DECISION; this function records the ONBOARDING. Never invent the former.
  IF v_stage <> 'HIRED' THEN RETURN 'NOT_HIRED'; END IF;
  IF v_existing IS NOT NULL THEN RETURN 'ALREADY_LINKED'; END IF;

  UPDATE "Application" SET "hiredEmployeeId" = p_employee_id, "updatedAt" = now()
  WHERE id = p_application_id;

  -- ▼ M4: they are staff now. Their record lives in employee-records, and the public-facing portal
  -- stops being a door into their interview and offer history. A no-op when they never made an
  -- account, which is the common case.
  PERFORM app_close_candidate_account(v_candidate_id);
  -- ▲ END M4 change

  -- Requisition lifecycle: fill the req once every opening has a hire behind it.
  SELECT j.openings INTO v_openings FROM "Job" j WHERE j.id = v_job_id;
  SELECT count(*) INTO v_hires FROM "Application" a
   WHERE a."jobId" = v_job_id AND a.stage = 'HIRED' AND a."hiredEmployeeId" IS NOT NULL;

  IF v_hires >= COALESCE(v_openings, 1) THEN
    UPDATE "Job" SET status = 'FILLED', "updatedAt" = now()
    WHERE id = v_job_id AND status = 'OPEN'; -- never resurrect a CLOSED/PAUSED req
  END IF;

  RETURN 'OK';
END;
$function$;
-- ── 3. THE DOORWAY THAT CHECKED NOTHING AT ALL ───────────────────────────────────────────────
--
-- Every other privileged SECURITY DEFINER write here verifies the caller inside the function —
-- app_erase_candidate calls app_can_manage_erasure(), app_link_hire checks the role,
-- app_confirm_interview_slot checks the assigned interviewer. This one checked nothing while being
-- EXECUTE-granted to hris_app: any caller could close any applicant's portal account from a
-- candidate id. Impact is lockout, not disclosure, and there is no production caller — app_link_hire
-- is the only one and it gates. But "safe because nothing calls it" stops being true quietly.
--
-- Roles mirror app_link_hire deliberately: closing the applicant account IS part of the hire, so
-- the two must not disagree about who may do it. app_link_hire's own PERFORM still passes — session
-- GUCs remain readable inside a SECURITY DEFINER call.
--
-- RAISE, never a silent no-op: a WHERE-clause guard would report success while doing nothing, which
-- is worse than no guard. And note the same coalesce() as above — written this way from the start
-- here, because the first draft of this function reproduced the very NULL bug it was fixing.
--
-- ⚠️ CREATE OR REPLACE is safe: same name, same argument type, same RETURNS void. Only the language
-- and body change. (Contrast M13, where adding RETURNS TABLE columns forced a DROP + re-GRANT.)
CREATE OR REPLACE FUNCTION app_close_candidate_account(p_candidate_id text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(current_setting('app.current_role', true), '') NOT IN ('HR_ADMIN', 'HR_GENERALIST', 'SYSTEM') THEN
    RAISE EXCEPTION 'not authorized to close a candidate account'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE "CandidateAccount"
     SET "closedAt"          = COALESCE("closedAt", now()),
         "loginTokenHash"    = NULL,
         "loginTokenExpires" = NULL,
         "updatedAt"         = now()
   WHERE "candidateId" = p_candidate_id;
END;
$$;

GRANT EXECUTE ON FUNCTION app_close_candidate_account(text) TO hris_app;
