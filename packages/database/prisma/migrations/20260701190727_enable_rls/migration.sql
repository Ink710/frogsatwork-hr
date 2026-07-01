-- Row-Level Security: the database itself filters which rows the restricted app role
-- (hris_app) can see, based on per-request session variables set by withViewer():
--   app.current_user_id, app.current_employee_id, app.current_role, app.current_org_id
--
-- Only hris_app is constrained. The owner (postgres) bypasses RLS (we don't FORCE it),
-- so migrations, the seed, and Studio are unaffected.

-- ---------------------------------------------------------------------------
-- Helper functions. SECURITY DEFINER => they run as the owner and therefore
-- BYPASS RLS on "Employee". That's essential: computing "who is in my subtree"
-- must see the whole tree, even though the caller can't.
-- ---------------------------------------------------------------------------

-- All employee ids in a manager's subtree (root included).
CREATE OR REPLACE FUNCTION app_subtree(root_id text)
RETURNS TABLE (id text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE tree AS (
    SELECT e.id FROM "Employee" e WHERE e.id = root_id
    UNION ALL
    SELECT e.id FROM "Employee" e JOIN tree t ON e."managerId" = t.id
  )
  SELECT id FROM tree
$$;

-- The employee's superiors (self excluded).
CREATE OR REPLACE FUNCTION app_ancestors(emp_id text)
RETURNS TABLE (id text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE chain AS (
    SELECT e.id, e."managerId" FROM "Employee" e WHERE e.id = emp_id
    UNION ALL
    SELECT e.id, e."managerId" FROM "Employee" e JOIN chain c ON e.id = c."managerId"
  )
  SELECT id FROM chain WHERE id <> emp_id
$$;

-- Resolve a user's employee id (used at login, before any session vars are set).
CREATE OR REPLACE FUNCTION app_employee_id_for_user(uid text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM "Employee" WHERE "userId" = uid LIMIT 1
$$;

-- The single source of truth for record visibility. Encapsulates org scoping + the
-- role rules, so every table's policy is a one-liner that calls this.
CREATE OR REPLACE FUNCTION app_can_see_employee(emp_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM "Employee" e
    WHERE e.id = emp_id
      AND e."orgId" = current_setting('app.current_org_id', true)
      AND (
        current_setting('app.current_role', true) IN
          ('HR_ADMIN', 'HR_GENERALIST', 'PAYROLL_ADMIN', 'SYSTEM')
        OR e.id = current_setting('app.current_employee_id', true)
        OR (
          current_setting('app.current_role', true) = 'MANAGER'
          AND e.id IN (SELECT app_subtree(current_setting('app.current_employee_id', true)))
        )
      )
  )
$$;

-- The functions must be callable by the restricted role.
GRANT EXECUTE ON FUNCTION app_subtree(text)             TO hris_app;
GRANT EXECUTE ON FUNCTION app_ancestors(text)           TO hris_app;
GRANT EXECUTE ON FUNCTION app_employee_id_for_user(text) TO hris_app;
GRANT EXECUTE ON FUNCTION app_can_see_employee(text)    TO hris_app;

-- ---------------------------------------------------------------------------
-- Enable RLS + policies. One FOR ALL policy per table, all delegating to
-- app_can_see_employee(). USING gates reads (and update/delete row targeting);
-- WITH CHECK gates rows being written. Append-only on the audit log is still
-- enforced separately by the column-level UPDATE/DELETE revoke.
-- ---------------------------------------------------------------------------

ALTER TABLE "Employee" ENABLE ROW LEVEL SECURITY;
CREATE POLICY employee_visibility ON "Employee" FOR ALL
  USING (app_can_see_employee(id))
  WITH CHECK (app_can_see_employee(id));

ALTER TABLE "EmployeeHistory" ENABLE ROW LEVEL SECURITY;
CREATE POLICY history_visibility ON "EmployeeHistory" FOR ALL
  USING (app_can_see_employee("employeeId"))
  WITH CHECK (app_can_see_employee("employeeId"));

ALTER TABLE "EmployeeDocument" ENABLE ROW LEVEL SECURITY;
CREATE POLICY document_visibility ON "EmployeeDocument" FOR ALL
  USING (app_can_see_employee("employeeId"))
  WITH CHECK (app_can_see_employee("employeeId"));

ALTER TABLE "EmergencyContact" ENABLE ROW LEVEL SECURITY;
CREATE POLICY emergency_visibility ON "EmergencyContact" FOR ALL
  USING (app_can_see_employee("employeeId"))
  WITH CHECK (app_can_see_employee("employeeId"));

ALTER TABLE "EmployeeAuditLog" ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_visibility ON "EmployeeAuditLog" FOR ALL
  USING (app_can_see_employee("employeeId"))
  WITH CHECK (app_can_see_employee("employeeId"));
