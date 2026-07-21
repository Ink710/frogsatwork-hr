-- CreateEnum
CREATE TYPE "LeaveType" AS ENUM ('VACATION', 'SICK', 'PERSONAL', 'UNPAID');

-- CreateEnum
CREATE TYPE "LeaveRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LeaveLedgerSource" AS ENUM ('OPENING', 'ACCRUAL', 'USAGE', 'ADJUSTMENT', 'REVERSAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditEventType" ADD VALUE 'TIME_OFF_REQUEST';
ALTER TYPE "AuditEventType" ADD VALUE 'TIME_OFF_APPROVE';
ALTER TYPE "AuditEventType" ADD VALUE 'TIME_OFF_DENY';
ALTER TYPE "AuditEventType" ADD VALUE 'TIME_OFF_CANCEL';

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" TEXT NOT NULL,
    "type" "LeaveType" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "hours" DECIMAL(6,2) NOT NULL,
    "status" "LeaveRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "decisionNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "employeeId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "reviewedById" TEXT,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveLedgerEntry" (
    "id" TEXT NOT NULL,
    "type" "LeaveType" NOT NULL,
    "hours" DECIMAL(7,2) NOT NULL,
    "source" "LeaveLedgerSource" NOT NULL,
    "note" TEXT,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "accrualPeriod" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "employeeId" TEXT NOT NULL,
    "leaveRequestId" TEXT,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "LeaveLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeavePolicy" (
    "id" TEXT NOT NULL,
    "type" "LeaveType" NOT NULL,
    "accrualHoursPerMonth" DECIMAL(6,2) NOT NULL,
    "maxBalanceHours" DECIMAL(7,2),
    "accrues" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "orgId" TEXT NOT NULL,

    CONSTRAINT "LeavePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeaveRequest_employeeId_startDate_idx" ON "LeaveRequest"("employeeId", "startDate");

-- CreateIndex
CREATE INDEX "LeaveLedgerEntry_employeeId_type_idx" ON "LeaveLedgerEntry"("employeeId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveLedgerEntry_employeeId_type_accrualPeriod_key" ON "LeaveLedgerEntry"("employeeId", "type", "accrualPeriod");

-- CreateIndex
CREATE UNIQUE INDEX "LeavePolicy_orgId_type_key" ON "LeavePolicy"("orgId", "type");

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveLedgerEntry" ADD CONSTRAINT "LeaveLedgerEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveLedgerEntry" ADD CONSTRAINT "LeaveLedgerEntry_leaveRequestId_fkey" FOREIGN KEY ("leaveRequestId") REFERENCES "LeaveRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveLedgerEntry" ADD CONSTRAINT "LeaveLedgerEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeavePolicy" ADD CONSTRAINT "LeavePolicy_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS (hand-added; `prisma migrate diff` does not emit policies). Same shape as the other
-- employee-scoped tables in 20260701190727_enable_rls: an employee sees their own rows, a manager
-- their reports', HR/Payroll/SYSTEM all — all delegated to app_can_see_employee("employeeId").
-- LeavePolicy is org-scoped config (not employee-scoped), so it gets NO RLS — like Department —
-- and its writes are gated app-side (HR_ADMIN via canManageLeavePolicies).
-- No explicit GRANT: ALTER DEFAULT PRIVILEGES (20260701050339_audit_append_only) already grants
-- new owner-created tables to hris_app.
ALTER TABLE "LeaveRequest" ENABLE ROW LEVEL SECURITY;
CREATE POLICY leave_request_visibility ON "LeaveRequest" FOR ALL
  USING (app_can_see_employee("employeeId"))
  WITH CHECK (app_can_see_employee("employeeId"));

ALTER TABLE "LeaveLedgerEntry" ENABLE ROW LEVEL SECURITY;
CREATE POLICY leave_ledger_visibility ON "LeaveLedgerEntry" FOR ALL
  USING (app_can_see_employee("employeeId"))
  WITH CHECK (app_can_see_employee("employeeId"));
