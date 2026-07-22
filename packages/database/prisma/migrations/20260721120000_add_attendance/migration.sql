-- CreateEnum
CREATE TYPE "ClockEventType" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "ClockSource" AS ENUM ('WEB', 'MANUAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditEventType" ADD VALUE 'CLOCK_IN';
ALTER TYPE "AuditEventType" ADD VALUE 'CLOCK_OUT';
ALTER TYPE "AuditEventType" ADD VALUE 'CLOCK_CORRECTION';

-- CreateTable
CREATE TABLE "ClockEvent" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "type" "ClockEventType" NOT NULL,
    "source" "ClockSource" NOT NULL DEFAULT 'WEB',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "employeeId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "ClockEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClockEvent_employeeId_at_idx" ON "ClockEvent"("employeeId", "at");

-- AddForeignKey
ALTER TABLE "ClockEvent" ADD CONSTRAINT "ClockEvent_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClockEvent" ADD CONSTRAINT "ClockEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- RLS (hand-added). Attendance is the standard EMPLOYEE-scoped visibility — own / manager-subtree /
-- HR — reusing app_can_see_employee, exactly like LeaveRequest / Timesheet / TimeEntry. One FOR ALL
-- policy covers reads and writes:
--   * a self-punch inserts a row for `self` → WITH CHECK app_can_see_employee(self) passes;
--   * an HR/manager MANUAL correction inserts/edits a row for a subject already in their scope → passes;
--   * an employee can never write a punch for someone outside their own id.
-- The app-layer additionally gates the correction ACTION to HR-or-manager (viewerCanApprove), the
-- same split as the comp guard and the approvals inbox: RLS scopes rows, the app gates the verb.
-- No explicit GRANT: ALTER DEFAULT PRIVILEGES (audit_append_only) already grants new tables to hris_app.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE "ClockEvent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY clock_event_visibility ON "ClockEvent" FOR ALL
  USING (app_can_see_employee("employeeId"))
  WITH CHECK (app_can_see_employee("employeeId"));
