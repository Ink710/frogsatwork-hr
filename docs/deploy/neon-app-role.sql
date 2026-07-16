-- Neon (or any hosted Postgres) — one-time setup of the restricted runtime role.
-- Run this ONCE, as the database OWNER, in Neon's SQL editor, BEFORE `prisma migrate deploy`.
-- It is the hosted equivalent of docker/init/01-app-role.sql (which runs automatically on the
-- local container's first boot).
--
-- Why a second, non-owner role: the app connects as `hris_app`, which does NOT own the tables and
-- is NOT a superuser, so the REVOKEs in the migrations (e.g. blocking UPDATE/DELETE on the audit
-- log) actually bite. A superuser/owner would bypass every REVOKE — which is exactly why the app
-- must not connect as the owner.
--
-- BEFORE RUNNING:
--   1. Replace 'CHANGE_ME_STRONG_PASSWORD' with a strong password. This becomes the password in
--      the app's DATABASE_URL (the hris_app pooled connection string).
--   2. Replace <DB_NAME> with your Neon database name (e.g. neondb, or a db you created).
--
-- Table-level grants and Row-Level Security are applied later by the Prisma migrations
-- (`prisma migrate deploy`), which run as the owner. Here we only create the role and let it
-- connect + use the public schema. The role name MUST be exactly `hris_app` (the migrations
-- reference it by name).

CREATE ROLE hris_app WITH LOGIN PASSWORD 'CHANGE_ME_STRONG_PASSWORD';

GRANT CONNECT ON DATABASE <DB_NAME> TO hris_app;
GRANT USAGE ON SCHEMA public TO hris_app;
