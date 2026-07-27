-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- AlterTable
ALTER TABLE "TimeEntry" ADD COLUMN     "meetingId" TEXT;

-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "status" "MeetingStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "orgId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingAssignment" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "meetingId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,

    CONSTRAINT "MeetingAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Meeting_orgId_status_idx" ON "Meeting"("orgId", "status");

-- CreateIndex
CREATE INDEX "MeetingAssignment_employeeId_idx" ON "MeetingAssignment"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingAssignment_meetingId_employeeId_key" ON "MeetingAssignment"("meetingId", "employeeId");

-- CreateIndex
CREATE INDEX "TimeEntry_meetingId_idx" ON "TimeEntry"("meetingId");

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAssignment" ADD CONSTRAINT "MeetingAssignment_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAssignment" ADD CONSTRAINT "MeetingAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAssignment" ADD CONSTRAINT "MeetingAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- RLS (hand-added, M10). MeetingAssignment is EMPLOYEE-scoped — the same one-liner as
-- ProjectAssignment / LeaveRequest / Timesheet / ClockEvent: an employee sees their own assignments,
-- a manager their subtree's, HR all. This scopes both the employee's timesheet activity picker (their
-- assigned meetings) and the manager's assignment editor for free. A manager assigning a report
-- (subtree) passes WITH CHECK; the row is visible to them, so create()'s RETURNING succeeds.
--   `Meeting` itself is org-scoped CONFIG with NO RLS (like Project / Department / LeavePolicy) —
--   names aren't sensitive, the picker only surfaces ASSIGNED meetings via the join above, and
--   management is gated in the app layer (creator + HR).
-- No explicit GRANT: ALTER DEFAULT PRIVILEGES (audit_append_only) already grants new tables to hris_app.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE "MeetingAssignment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY meeting_assignment_visibility ON "MeetingAssignment" FOR ALL
  USING (app_can_see_employee("employeeId"))
  WITH CHECK (app_can_see_employee("employeeId"));
