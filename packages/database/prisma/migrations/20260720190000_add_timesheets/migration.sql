-- CreateEnum
CREATE TYPE "TimesheetStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditEventType" ADD VALUE 'TIMESHEET_SUBMIT';
ALTER TYPE "AuditEventType" ADD VALUE 'TIMESHEET_APPROVE';
ALTER TYPE "AuditEventType" ADD VALUE 'TIMESHEET_REJECT';

-- CreateTable
CREATE TABLE "Timesheet" (
    "id" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "TimesheetStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "employeeId" TEXT NOT NULL,
    "reviewedById" TEXT,

    CONSTRAINT "Timesheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL,
    "workDate" TIMESTAMP(3) NOT NULL,
    "hours" DECIMAL(5,2) NOT NULL,
    "project" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "timesheetId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Timesheet_employeeId_status_idx" ON "Timesheet"("employeeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Timesheet_employeeId_periodStart_key" ON "Timesheet"("employeeId", "periodStart");

-- CreateIndex
CREATE INDEX "TimeEntry_timesheetId_idx" ON "TimeEntry"("timesheetId");

-- CreateIndex
CREATE INDEX "TimeEntry_employeeId_workDate_idx" ON "TimeEntry"("employeeId", "workDate");

-- AddForeignKey
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_timesheetId_fkey" FOREIGN KEY ("timesheetId") REFERENCES "Timesheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS (hand-added; `prisma migrate diff` does not emit policies). Same shape as every other
-- employee-scoped table (20260701190727_enable_rls): an employee sees their own rows, a manager
-- their reports', HR/Payroll/SYSTEM all — delegated to app_can_see_employee("employeeId").
-- TimeEntry denormalizes employeeId precisely so this stays a one-liner.
-- No explicit GRANT: ALTER DEFAULT PRIVILEGES (20260701050339_audit_append_only) already grants
-- new owner-created tables to hris_app.
ALTER TABLE "Timesheet" ENABLE ROW LEVEL SECURITY;
CREATE POLICY timesheet_visibility ON "Timesheet" FOR ALL
  USING (app_can_see_employee("employeeId"))
  WITH CHECK (app_can_see_employee("employeeId"));

ALTER TABLE "TimeEntry" ENABLE ROW LEVEL SECURITY;
CREATE POLICY time_entry_visibility ON "TimeEntry" FOR ALL
  USING (app_can_see_employee("employeeId"))
  WITH CHECK (app_can_see_employee("employeeId"));
