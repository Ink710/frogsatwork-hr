-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "hiredEmployeeId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Application_hiredEmployeeId_key" ON "Application"("hiredEmployeeId");

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_hiredEmployeeId_fkey" FOREIGN KEY ("hiredEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- THE HIRE SEAM — the one place the ATS and employee-records domains touch.
--
-- The problem: NEITHER role spans this seam.
--
--                          create employees        write "Application" rows
--                          (canEditEmployee)       (app_can_manage_job)
--   HR_ADMIN                     yes                        yes
--   HR_GENERALIST                yes                        NO
--   RECRUITER                    NO                         yes
--
-- So an HR generalist can create the employee but cannot record the link back, and a recruiter can
-- do the reverse. Both obvious "fixes" are wrong: widening app_can_manage_job to HR_GENERALIST hands
-- them requisition control, and widening canEditEmployee to RECRUITER hands them employee and
-- compensation data — which the suite has deliberately withheld since employee-records M2.
--
-- Instead the seam gets ONE narrow doorway, gated on the EMPLOYEE-CREATING roles, because onboarding
-- is owned by the people who own employee data. No existing policy is widened, and a plain
-- UPDATE on "Application" from an HR generalist stays refused — this function is the only way through.
--
-- It also enforces the requisition rule in the same privileged step, where it can't be skipped:
-- count the hires, and FILL the req once its openings are used up (which also removes it from the
-- public careers page, since app_public_jobs() only returns OPEN postings).
--
-- Idempotent by design: retrying a link returns ALREADY_LINKED and changes nothing, so the caller —
-- which runs this AFTER its own transaction commits — can safely be retried.
--
-- Returns: 'OK' | 'FORBIDDEN' | 'NOT_HIRED' | 'ALREADY_LINKED' | 'NOT_FOUND'
-- ═════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION app_link_hire(p_application_id text, p_employee_id text)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stage    "ApplicationStage";
  v_job_id   text;
  v_existing text;
  v_org_id   text;
  v_openings integer;
  v_hires    integer;
BEGIN
  -- Onboarding belongs to whoever owns employee records — NOT to recruiters.
  IF current_setting('app.current_role', true) NOT IN ('HR_ADMIN', 'HR_GENERALIST', 'SYSTEM') THEN
    RETURN 'FORBIDDEN';
  END IF;

  SELECT a.stage, a."jobId", a."hiredEmployeeId", a."orgId"
    INTO v_stage, v_job_id, v_existing, v_org_id
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
$$;

GRANT EXECUTE ON FUNCTION app_link_hire(text, text) TO hris_app;
