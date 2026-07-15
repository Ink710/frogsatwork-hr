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

  // Under the full suite's load a Prisma interactive transaction can time out and leave a backend
  // "idle in transaction" — still holding locks, which would make the TRUNCATE below wait forever
  // (the 10s beforeEach hook then times out and the whole run stalls). Terminate any such backend
  // first; the app's pool just reconnects lazily on its next query.
  await owner.query(`
    SELECT pg_terminate_backend(pid) FROM pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid()
      AND state = 'idle in transaction'`);
  // Belt-and-suspenders: if a lock is still held, fail fast with a clear error rather than hang.
  await owner.query("SET lock_timeout = '8s'");
  await owner.query(
    `TRUNCATE ${TABLES.map((t) => (t.startsWith('"') ? t : `"${t}"`)).join(", ")} RESTART IDENTITY CASCADE`,
  );
  await owner.end();
  execSync("pnpm exec prisma db seed", { cwd: dbPackageDir, env: { ...process.env }, stdio: "ignore" });
}
