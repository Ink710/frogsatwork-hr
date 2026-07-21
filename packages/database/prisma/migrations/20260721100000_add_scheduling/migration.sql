-- CreateEnum
CREATE TYPE "ShiftSwapStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditEventType" ADD VALUE 'SHIFT_SWAP_REQUEST';
ALTER TYPE "AuditEventType" ADD VALUE 'SHIFT_SWAP_APPROVE';
ALTER TYPE "AuditEventType" ADD VALUE 'SHIFT_SWAP_DENY';

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "role" TEXT,
    "note" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "departmentId" TEXT NOT NULL,
    "employeeId" TEXT,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftSwapRequest" (
    "id" TEXT NOT NULL,
    "reason" TEXT,
    "status" "ShiftSwapStatus" NOT NULL DEFAULT 'PENDING',
    "decisionNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "shiftId" TEXT NOT NULL,
    "requestedByEmployeeId" TEXT NOT NULL,
    "targetEmployeeId" TEXT,
    "reviewedById" TEXT,

    CONSTRAINT "ShiftSwapRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Shift_departmentId_startAt_idx" ON "Shift"("departmentId", "startAt");

-- CreateIndex
CREATE INDEX "Shift_employeeId_idx" ON "Shift"("employeeId");

-- CreateIndex
CREATE INDEX "ShiftSwapRequest_requestedByEmployeeId_status_idx" ON "ShiftSwapRequest"("requestedByEmployeeId", "status");

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftSwapRequest" ADD CONSTRAINT "ShiftSwapRequest_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftSwapRequest" ADD CONSTRAINT "ShiftSwapRequest_requestedByEmployeeId_fkey" FOREIGN KEY ("requestedByEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftSwapRequest" ADD CONSTRAINT "ShiftSwapRequest_targetEmployeeId_fkey" FOREIGN KEY ("targetEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftSwapRequest" ADD CONSTRAINT "ShiftSwapRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- RLS (hand-added). Scheduling deliberately uses DEPARTMENT-scoped visibility, not the usual
-- employee-scoped app_can_see_employee — a published shift is the *posted schedule*, visible to
-- everyone in the department. To keep that broad READ from also broadening WRITES, reads and writes
-- get SEPARATE policies (Postgres OR-combines permissive policies per command):
--   shift_read  (FOR SELECT)          → app_can_see_shift    (dept-published + own + manager/HR)
--   shift_write (FOR INSERT/UPDATE/DELETE via FOR ALL) → app_can_manage_shift (manager-of-dept + HR)
-- No explicit GRANT: ALTER DEFAULT PRIVILEGES (audit_append_only) already grants new tables to hris_app.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- Who may SEE a shift row. Org-scoped, then: HR/Payroll/SYSTEM see all; you always see your own
-- shift; a MANAGER sees every shift in their OWN department (draft included); any dept member sees
-- PUBLISHED shifts of their department. (`emp_id` is NULL for open shifts → the "own" branch is
-- simply false, and open published shifts show via the dept branch.)
CREATE OR REPLACE FUNCTION app_can_see_shift(dept_id text, emp_id text, published boolean)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
      SELECT 1 FROM "Department" d
      WHERE d.id = dept_id AND d."orgId" = current_setting('app.current_org_id', true)
    ) AND (
      current_setting('app.current_role', true) IN ('HR_ADMIN', 'HR_GENERALIST', 'PAYROLL_ADMIN', 'SYSTEM')
      OR emp_id = current_setting('app.current_employee_id', true)
      OR (
        current_setting('app.current_role', true) = 'MANAGER'
        AND dept_id = (SELECT "departmentId" FROM "Employee" WHERE id = current_setting('app.current_employee_id', true))
      )
      OR (
        published
        AND dept_id = (SELECT "departmentId" FROM "Employee" WHERE id = current_setting('app.current_employee_id', true))
      )
    )
$$;

-- Who may WRITE a department's schedule: HR (admin/generalist) + SYSTEM, or the MANAGER of that
-- department. Deliberately NOT the assigned employee — an employee can't create/edit their own shift.
CREATE OR REPLACE FUNCTION app_can_manage_shift(dept_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
      SELECT 1 FROM "Department" d
      WHERE d.id = dept_id AND d."orgId" = current_setting('app.current_org_id', true)
    ) AND (
      current_setting('app.current_role', true) IN ('HR_ADMIN', 'HR_GENERALIST', 'SYSTEM')
      OR (
        current_setting('app.current_role', true) = 'MANAGER'
        AND dept_id = (SELECT "departmentId" FROM "Employee" WHERE id = current_setting('app.current_employee_id', true))
      )
    )
$$;

GRANT EXECUTE ON FUNCTION app_can_see_shift(text, text, boolean) TO hris_app;
GRANT EXECUTE ON FUNCTION app_can_manage_shift(text)             TO hris_app;

ALTER TABLE "Shift" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shift_read ON "Shift" FOR SELECT
  USING (app_can_see_shift("departmentId", "employeeId", "published"));
CREATE POLICY shift_write ON "Shift" FOR ALL
  USING (app_can_manage_shift("departmentId"))
  WITH CHECK (app_can_manage_shift("departmentId"));

-- Swap requests are employee-scoped like leave/timesheets: the requester's manager (subtree) + HR see
-- them; the employee may create their own. One FOR ALL policy on app_can_see_employee is enough.
ALTER TABLE "ShiftSwapRequest" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shift_swap_visibility ON "ShiftSwapRequest" FOR ALL
  USING (app_can_see_employee("requestedByEmployeeId"))
  WITH CHECK (app_can_see_employee("requestedByEmployeeId"));
