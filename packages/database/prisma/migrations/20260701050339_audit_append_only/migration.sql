-- Grant the restricted runtime role (hris_app) the privileges it needs, then lock
-- down the audit log so it is APPEND-ONLY at the database level.
--
-- Why at the DB and not just in app code: application checks can be bypassed by a
-- bug, a rogue query, or a compromised process. A REVOKE is enforced by Postgres
-- itself on every statement, for this role, no matter what the app does. Because
-- hris_app is NOT a superuser and does NOT own the tables, the REVOKE actually bites.

-- 1. Baseline DML for the app role on everything that exists now.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hris_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO hris_app;

-- 2. Future tables created by the owner (postgres) are auto-granted to hris_app,
--    so we don't have to repeat step 1 after every migration.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hris_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO hris_app;

-- 3. The audit log is INSERT + SELECT only. Revoke the ability to change history.
REVOKE UPDATE, DELETE ON "EmployeeAuditLog" FROM hris_app;
