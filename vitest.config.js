import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Each app uses the Next "@/*" import alias, but pointing at ITS OWN root — so tests must resolve
// `@` per app. `server-only` throws under bare Node (default export condition); stub it to a no-op
// so server modules can be exercised in tests (Next resolves it correctly at build time).
const serverOnly = fileURLToPath(new URL("./test/server-only-stub.js", import.meta.url));
const employeeRecordsAlias = {
  "@": fileURLToPath(new URL("./apps/employee-records", import.meta.url)),
  "server-only": serverOnly,
};
const timeManagementAlias = {
  "@": fileURLToPath(new URL("./apps/time-management", import.meta.url)),
  "server-only": serverOnly,
};
const atsAlias = {
  "@": fileURLToPath(new URL("./apps/ats", import.meta.url)),
  "server-only": serverOnly,
};
const candidatePortalAlias = {
  "@": fileURLToPath(new URL("./apps/candidate-portal", import.meta.url)),
  "server-only": serverOnly,
};

// Shared integration-project settings (fresh migrated+seeded hris_test, sequential files).
const integrationBase = {
  exclude: ["**/node_modules/**", "**/.next/**"],
  environment: "node",
  globalSetup: ["./test/globalSetup.js"],
  setupFiles: ["./test/loadTestEnv.js"],
  fileParallelism: false,
  // resetDb() (the beforeEach fixture) TRUNCATEs and then re-runs the whole seed in a subprocess —
  // pnpm + prisma CLI startup plus every upsert. That fixture has grown with the schema (time
  // management, then recruiting), and under full-suite load it regularly exceeded Vitest's default
  // 10s hook timeout, failing a RANDOM test each run with "Hook timed out". The work is legitimately
  // slow, not stuck, so give it real headroom.
  hookTimeout: 45000,
};

export default defineConfig({
  test: {
    projects: [
      {
        // Unit: pure package logic + employee-records lib. No DB. Fast.
        resolve: { alias: employeeRecordsAlias },
        test: {
          name: "unit",
          include: [
            "packages/**/src/**/*.test.js",
            "apps/employee-records/lib/**/*.test.js",
            // The ATS has its own signed-link helper (résumé downloads), pure and DB-free like er's.
            "apps/ats/lib/**/*.test.js",
          ],
          exclude: ["**/node_modules/**", "**/.next/**", "**/*.itest.js"],
          environment: "node",
        },
      },
      {
        resolve: { alias: employeeRecordsAlias },
        test: { name: "integration", include: ["apps/employee-records/**/*.itest.js", "packages/**/*.itest.js"], ...integrationBase },
      },
      {
        // Separate project so time-management's `@/…` imports resolve to ITS root. Run in its own
        // `vitest run` invocation (see package.json test:integration) so its globalSetup/reseed of
        // hris_test never races the employee-records integration project.
        resolve: { alias: timeManagementAlias },
        test: { name: "integration-tm", include: ["apps/time-management/**/*.itest.js"], ...integrationBase },
      },
      {
        // Same, for the ATS app — its own `@/…` root + its own reseeding invocation.
        resolve: { alias: atsAlias },
        test: { name: "integration-ats", include: ["apps/ats/**/*.itest.js"], ...integrationBase },
      },
      {
        // Same again, for the candidate portal (app 4).
        resolve: { alias: candidatePortalAlias },
        test: { name: "integration-portal", include: ["apps/candidate-portal/**/*.itest.js"], ...integrationBase },
      },
    ],
  },
});
