-- Allow HR (admin/generalist) + system to INSERT a new Employee. The existing FOR ALL
-- policy's WITH CHECK calls app_can_see_employee(id), which does EXISTS(SELECT … FROM
-- "Employee" WHERE id = …) — that can't see the brand-new row at insert time, so it would
-- reject the create. This dedicated INSERT policy evaluates the NEW row's columns directly
-- (no self-query). Permissive policies are OR'd for INSERT, so this admits the create while
-- the FOR ALL policy still governs SELECT/UPDATE/DELETE visibility.
CREATE POLICY employee_insert ON "Employee" FOR INSERT
  WITH CHECK (
    "orgId" = current_setting('app.current_org_id', true)
    AND current_setting('app.current_role', true) IN ('HR_ADMIN', 'HR_GENERALIST', 'SYSTEM')
  );
