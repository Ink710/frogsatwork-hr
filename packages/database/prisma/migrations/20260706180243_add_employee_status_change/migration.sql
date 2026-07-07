-- CreateEnum
CREATE TYPE "StatusChangeType" AS ENUM ('LEAVE', 'SUSPENSION');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditEventType" ADD VALUE 'LEAVE';
ALTER TYPE "AuditEventType" ADD VALUE 'SUSPEND';
ALTER TYPE "AuditEventType" ADD VALUE 'REINSTATE';

-- CreateTable
CREATE TABLE "EmployeeStatusChange" (
    "id" TEXT NOT NULL,
    "type" "StatusChangeType" NOT NULL,
    "reason" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "expectedEnd" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "employeeId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "EmployeeStatusChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeeStatusChange_employeeId_startDate_idx" ON "EmployeeStatusChange"("employeeId", "startDate");

-- AddForeignKey
ALTER TABLE "EmployeeStatusChange" ADD CONSTRAINT "EmployeeStatusChange_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeStatusChange" ADD CONSTRAINT "EmployeeStatusChange_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS (hand-added; prisma migrate diff does not emit policies). Same shape as the other
-- employee-scoped tables in 20260701190727_enable_rls: a manager/HR sees their reports'
-- status records; an employee sees their own rows. Field-level visibility (hiding a
-- suspension's reason from the subject) is enforced app-side in getEmployeeProfile.
-- No explicit GRANT: ALTER DEFAULT PRIVILEGES (20260701050339_audit_append_only) already
-- grants new owner-created tables to hris_app.
ALTER TABLE "EmployeeStatusChange" ENABLE ROW LEVEL SECURITY;
CREATE POLICY status_change_visibility ON "EmployeeStatusChange" FOR ALL
  USING (app_can_see_employee("employeeId"))
  WITH CHECK (app_can_see_employee("employeeId"));
