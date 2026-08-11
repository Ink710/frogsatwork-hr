-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- MAKE `prisma migrate reset` SAFE FOR THE TWO-ROLE SETUP
--
-- Found the hard way (M11): after a `migrate reset` the whole app died with
-- `relation "Organization" does not exist` for every query, and a build failure claiming
-- `function app_public_jobs() does not exist`. Neither message is what was actually wrong.
--
-- THE CAUSE: `migrate reset` does DROP SCHEMA public CASCADE + CREATE SCHEMA public. The hris_app
-- ROLE survives (roles are cluster-level, not schema-level) and so do its table privileges, because
-- this schema's ALTER DEFAULT PRIVILEGES re-grants them as each table is recreated. What does NOT
-- survive is `GRANT USAGE ON SCHEMA public TO hris_app` — that grant belonged to the dropped schema.
-- Without USAGE the role cannot see ANYTHING in the schema, and Postgres reports that as "does not
-- exist" rather than "permission denied", which is why the error points nowhere near the cause.
--
-- That grant lives in docker/init/01-app-role.sql, which by design runs ONCE on first container
-- init — so it never runs again to repair this.
--
-- THE FIX: assert it here. Migrations replay in full on every reset, so the grant is restored every
-- time. Idempotent, so it is a no-op on a normal deploy.
--
-- Guarded on the role existing, because migrations also run where it does not yet: CI spins up a
-- bare Postgres, and a fresh Neon database has the role created separately by
-- docs/deploy/neon-app-role.sql. An unguarded GRANT would fail the whole migration there.
-- ═════════════════════════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hris_app') THEN
    GRANT USAGE ON SCHEMA public TO hris_app;
  END IF;
END
$$;
