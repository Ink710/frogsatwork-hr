-- Move Department.budget into its own RLS-protected table so budget can't be read without
-- passing the access policy at the DATABASE level (previously only guarded in app code).

-- 1. New table (mirrors the Prisma diff).
CREATE TABLE "DepartmentBudget" (
    "departmentId" TEXT NOT NULL,
    "budget" DECIMAL(14,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DepartmentBudget_pkey" PRIMARY KEY ("departmentId")
);
ALTER TABLE "DepartmentBudget"
    ADD CONSTRAINT "DepartmentBudget_departmentId_fkey"
    FOREIGN KEY ("departmentId") REFERENCES "Department"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. Copy existing budgets across BEFORE dropping the column.
INSERT INTO "DepartmentBudget" ("departmentId", "budget", "updatedAt")
SELECT id, budget, now() FROM "Department" WHERE budget IS NOT NULL;

-- 3. Remove the now-unguarded column.
ALTER TABLE "Department" DROP COLUMN "budget";

-- 4. App role gets DML (belt-and-suspenders; ALTER DEFAULT PRIVILEGES already covers it).
GRANT SELECT, INSERT, UPDATE, DELETE ON "DepartmentBudget" TO hris_app;

-- 5. The access rule as a SECURITY DEFINER function (mirrors app-layer canViewBudget), read
--    from the same session vars withViewer sets. Bypasses RLS to read Employee/Department.
CREATE OR REPLACE FUNCTION app_can_see_budget(dept_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- HR admin + payroll: every department.
    current_setting('app.current_role', true) IN ('HR_ADMIN', 'PAYROLL_ADMIN')
    -- HR generalist: everyone EXCEPT their own department.
    OR (
      current_setting('app.current_role', true) = 'HR_GENERALIST'
      AND dept_id <> COALESCE(
        (SELECT "departmentId" FROM "Employee" WHERE id = current_setting('app.current_employee_id', true)),
        ''
      )
    )
    -- Manager: only their own department (member of, or head of).
    OR (
      current_setting('app.current_role', true) = 'MANAGER'
      AND (
        dept_id = (SELECT "departmentId" FROM "Employee" WHERE id = current_setting('app.current_employee_id', true))
        OR EXISTS (
          SELECT 1 FROM "Department" d
          WHERE d.id = dept_id AND d."headUserId" = current_setting('app.current_user_id', true)
        )
      )
    )
$$;
GRANT EXECUTE ON FUNCTION app_can_see_budget(text) TO hris_app;

-- 6. RLS: a budget row is visible only when the rule passes. This is the DB-level wall.
ALTER TABLE "DepartmentBudget" ENABLE ROW LEVEL SECURITY;
CREATE POLICY budget_visibility ON "DepartmentBudget" FOR ALL
  USING (app_can_see_budget("departmentId"))
  WITH CHECK (app_can_see_budget("departmentId"));
