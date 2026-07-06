// Vitest globalSetup for integration tests: guarantees a fresh, migrated, seeded
// `hris_test` database before any *.itest.js runs. The dev `hris` DB is never touched.
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { config } from "dotenv";
import pg from "pg";

config({ path: fileURLToPath(new URL("../.env.test", import.meta.url)) });

const dbPackageDir = fileURLToPath(new URL("../packages/database", import.meta.url));
const MAINTENANCE_URL = "postgresql://postgres:postgres@localhost:5433/postgres";

export async function setup() {
  // 1. From the maintenance DB: ensure the restricted app role exists (docker-compose
  //    creates it locally, but a bare CI runner won't have it), then create hris_test.
  const admin = new pg.Client({ connectionString: MAINTENANCE_URL });
  await admin.connect();
  await admin.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hris_app') THEN
        CREATE ROLE hris_app WITH LOGIN PASSWORD 'hris_app_pw';
      END IF;
    END $$;
  `);
  const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = 'hris_test'");
  if (!rowCount) await admin.query("CREATE DATABASE hris_test");
  await admin.end();

  // 2. Let the restricted app role connect + use the schema (table-level grants come from
  //    the audit_append_only / enable_rls migrations).
  const owner = new pg.Client({ connectionString: process.env.DIRECT_URL });
  await owner.connect();
  await owner.query("GRANT CONNECT ON DATABASE hris_test TO hris_app");
  await owner.query("GRANT USAGE ON SCHEMA public TO hris_app");
  await owner.end();

  // 3. Apply all migrations + seed. execSync inherits our env (DIRECT_URL=hris_test);
  //    prisma.config.ts/seed use non-overriding dotenv, so this stays pointed at the test DB.
  const env = { ...process.env };
  execSync("pnpm exec prisma migrate deploy", { cwd: dbPackageDir, env, stdio: "inherit" });
  execSync("pnpm exec prisma db seed", { cwd: dbPackageDir, env, stdio: "inherit" });
}
