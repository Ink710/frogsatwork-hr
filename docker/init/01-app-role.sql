-- Runs ONCE on first container init (empty data dir), as the postgres superuser.
--
-- Creates the restricted runtime role the Next.js app connects as. It deliberately
-- is NOT a superuser and does NOT own the tables, so REVOKEs we apply later (e.g.
-- blocking UPDATE/DELETE on the audit log) actually take effect. A superuser would
-- bypass every REVOKE, which is exactly why we don't run the app as `postgres`.
--
-- Table-level grants live in the Prisma migration (Step 5), because the tables don't
-- exist yet at this point. Here we only create the role and let it connect + use the
-- public schema.
CREATE ROLE hris_app WITH LOGIN PASSWORD 'hris_app_pw';

GRANT CONNECT ON DATABASE hris TO hris_app;
GRANT USAGE ON SCHEMA public TO hris_app;
