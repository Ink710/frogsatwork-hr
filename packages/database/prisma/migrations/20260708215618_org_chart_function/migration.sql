-- Company-wide org chart projection. The employee-records app shows the COMPLETE reporting
-- structure to every signed-in user (it's a directory), while profiles stay RLS-protected.
-- This SECURITY DEFINER function runs as the owner, so it bypasses the Employee RLS and can see
-- all rows — but it returns ONLY non-sensitive structure columns (name, title, department,
-- manager link). It physically cannot leak compensation, contact details, etc. Same pattern as
-- app_can_see_employee / app_subtree.
CREATE OR REPLACE FUNCTION app_org_chart(p_org_id text)
RETURNS TABLE (
  id text,
  "firstName" text,
  "lastName" text,
  "jobTitle" text,
  department text,
  "managerId" text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    e.id,
    e."firstName",
    e."lastName",
    h."jobTitle",
    d.name,
    e."managerId"
  FROM "Employee" e
  LEFT JOIN "EmployeeHistory" h
    ON h."employeeId" = e.id AND h."effectiveTo" IS NULL
  LEFT JOIN "Department" d
    ON d.id = e."departmentId"
  WHERE e."orgId" = p_org_id
    AND e."employmentStatus" <> 'TERMINATED'::"EmploymentStatus"
$$;

GRANT EXECUTE ON FUNCTION app_org_chart(text) TO hris_app;
