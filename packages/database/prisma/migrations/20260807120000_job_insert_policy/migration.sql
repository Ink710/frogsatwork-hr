-- Allow a recruiter/HR user to CREATE a job requisition.
--
-- The problem this fixes (verified in psql before writing it): the M1 policy is
--
--   CREATE POLICY job_write ON "Job" FOR ALL
--     USING (app_can_manage_job(id)) WITH CHECK (app_can_manage_job(id));
--
-- and `app_can_manage_job(id)` decides by LOOKING THE JOB UP in the "Job" table. During an INSERT
-- that row is not yet visible to the command, so the WITH CHECK evaluated false and *every* job
-- creation was refused — even by a recruiter who is plainly entitled to it:
--
--   ERROR: new row violates row-level security policy for table "Job"
--
-- (Same family as the createEmployee gotcha, where INSERT … RETURNING re-applies the SELECT policy
-- to a row that cannot be seen mid-insert.)
--
-- The fix is a dedicated INSERT policy that judges the NEW ROW'S OWN COLUMNS instead of re-reading
-- the table: the org must match the caller's session, and the caller must hold a recruiting role.
-- No row lookup, so nothing depends on visibility timing.
--
-- Postgres OR-combines PERMISSIVE policies per command, so this admits legitimate creates while
-- `job_write` continues to govern UPDATE/DELETE (and still gates INSERT for anyone this doesn't
-- cover). Membership-based management is unchanged: a HIRING_MANAGER can still manage a req they
-- were added to, but only recruiting roles can open a brand-new one — which is also exactly what
-- the app-layer canCreateJob() check enforces.
CREATE POLICY job_insert ON "Job" FOR INSERT
  WITH CHECK (
    "orgId" = current_setting('app.current_org_id', true)
    AND current_setting('app.current_role', true) IN ('HR_ADMIN', 'HR_GENERALIST', 'RECRUITER', 'SYSTEM')
  );
