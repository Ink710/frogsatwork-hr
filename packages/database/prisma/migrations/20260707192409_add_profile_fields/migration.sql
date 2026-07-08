-- Profile revamp: new employment/comp classifications + descriptive & review fields.
-- Table-level grants (ALL TABLES / default privileges) already cover these new columns,
-- so no GRANT changes are needed for the hris_app role.

-- CreateEnum
CREATE TYPE "FlsaClassification" AS ENUM ('EXEMPT', 'NON_EXEMPT');
CREATE TYPE "PayFrequency" AS ENUM ('WEEKLY', 'BIWEEKLY', 'SEMI_MONTHLY', 'MONTHLY');
CREATE TYPE "PayBasis" AS ENUM ('PER_HOUR', 'PER_MONTH', 'PER_YEAR');

-- AlterTable: Employee
-- Rename (not drop+add) so any existing location data survives; the column was always a
-- plain display string, never a real FK despite the "Id" suffix.
ALTER TABLE "Employee" RENAME COLUMN "locationId" TO "location";
ALTER TABLE "Employee"
  ADD COLUMN "phone"          TEXT,
  ADD COLUMN "workSchedule"   TEXT,
  ADD COLUMN "timeZone"       TEXT,
  ADD COLUMN "lastReviewDate" TIMESTAMP(3),
  ADD COLUMN "nextReviewDate" TIMESTAMP(3),
  ADD COLUMN "equityNote"     TEXT;

-- AlterTable: EmployeeHistory — versioned comp/role attributes (nullable: existing rows keep NULL,
-- forward writes populate them).
ALTER TABLE "EmployeeHistory"
  ADD COLUMN "flsaClassification" "FlsaClassification",
  ADD COLUMN "payFrequency"       "PayFrequency",
  ADD COLUMN "payBasis"           "PayBasis";
