// Per-test isolation for write suites: truncate every table (owner) then re-seed. The seed
// is tiny, so this is fast enough to run in beforeEach.
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import pg from "pg";

const dbPackageDir = fileURLToPath(new URL("../packages/database", import.meta.url));

const TABLES = [
  "EmployeeAuditLog",
  "EmployeeHistory",
  "EmergencyContact",
  "EmployeeDocument",
  "Employee",
  "DepartmentBudget",
  "Department",
  '"User"',
  "Organization",
];

export async function resetDb() {
  const owner = new pg.Client({ connectionString: process.env.DIRECT_URL });
  await owner.connect();

  // Clear backends stuck holding locks: a Prisma interactive transaction that timed out leaves one
  // "idle in transaction", which would block the TRUNCATE below and the seed that follows.
  //
  // Deliberately NARROW. Terminating *every* connection was tried and made things worse — it kills
  // healthy pooled connections on every single test, so Prisma spends the suite reconnecting and
  // retrying (runtime went 55s → 197s). The guarantee that nothing can hang FOREVER comes from the
  // database-level lock_timeout/statement_timeout set in globalSetup, which every connection
  // inherits — including the seed subprocess. This query just tidies the common stuck case.
  await owner.query(`
    SELECT pg_terminate_backend(pid) FROM pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid()
      AND state IN ('idle in transaction', 'idle in transaction (aborted)')`);
  // Belt-and-suspenders: if a lock is still held, fail fast with a clear error rather than hang.
  await owner.query("SET lock_timeout = '8s'");
  await owner.query(
    `TRUNCATE ${TABLES.map((t) => (t.startsWith('"') ? t : `"${t}"`)).join(", ")} RESTART IDENTITY CASCADE`,
  );
  await owner.end();
  execSync("pnpm exec prisma db seed", { cwd: dbPackageDir, env: { ...process.env }, stdio: "ignore" });
}
