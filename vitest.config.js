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

// Shared integration-project settings (fresh migrated+seeded hris_test, sequential files).
const integrationBase = {
  exclude: ["**/node_modules/**", "**/.next/**"],
  environment: "node",
  globalSetup: ["./test/globalSetup.js"],
  setupFiles: ["./test/loadTestEnv.js"],
  fileParallelism: false,
};

export default defineConfig({
  test: {
    projects: [
      {
        // Unit: pure package logic + employee-records lib. No DB. Fast.
        resolve: { alias: employeeRecordsAlias },
        test: {
          name: "unit",
          include: ["packages/**/src/**/*.test.js", "apps/employee-records/lib/**/*.test.js"],
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
    ],
  },
});
