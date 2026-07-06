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
  "Department",
  '"User"',
  "Organization",
];

export async function resetDb() {
  const owner = new pg.Client({ connectionString: process.env.DIRECT_URL });
  await owner.connect();
  await owner.query(
    `TRUNCATE ${TABLES.map((t) => (t.startsWith('"') ? t : `"${t}"`)).join(", ")} RESTART IDENTITY CASCADE`,
  );
  await owner.end();
  execSync("pnpm exec prisma db seed", { cwd: dbPackageDir, env: { ...process.env }, stdio: "ignore" });
}
