-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditEventType" ADD VALUE 'CORRECTION';
ALTER TYPE "AuditEventType" ADD VALUE 'REHIRE';

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "eligibleForRehire" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "rehireDate" TIMESTAMP(3),
ADD COLUMN     "terminationReason" TEXT;

-- AlterTable
ALTER TABLE "EmployeeHistory" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
