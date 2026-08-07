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

  // A leftover backend still holding locks makes the TRUNCATE below — and, worse, the seed
  // subprocess at the end of this function — wait on it, which used to hang the whole beforeEach.
  // Terminate EVERY other connection to this database, whatever its state: `idle in transaction`
  // was too narrow (an `active` or `idle in transaction (aborted)` backend holds locks just the
  // same). Safe because hris_test is a dedicated test database owned by this process — nothing else
  // legitimately connects to it, and Prisma's pool just reconnects lazily on its next query.
  await owner.query(`
    SELECT pg_terminate_backend(pid) FROM pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid()`);
  // Belt-and-suspenders: if a lock is still held, fail fast with a clear error rather than hang.
  await owner.query("SET lock_timeout = '8s'");
  await owner.query(
    `TRUNCATE ${TABLES.map((t) => (t.startsWith('"') ? t : `"${t}"`)).join(", ")} RESTART IDENTITY CASCADE`,
  );
  await owner.end();
  execSync("pnpm exec prisma db seed", { cwd: dbPackageDir, env: { ...process.env }, stdio: "ignore" });
}
