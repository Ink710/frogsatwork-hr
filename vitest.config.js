import { defineConfig } from "vitest/config";

// Two projects. `unit` is pure/fast with no DB. `integration` (added in a later phase)
// hits a dedicated test Postgres via a global setup. Select with --project <name>.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: [
            "packages/**/src/**/*.test.js",
            "apps/**/lib/**/*.test.js",
          ],
          exclude: ["**/node_modules/**", "**/.next/**", "**/*.itest.js"],
          environment: "node",
        },
      },
      {
        test: {
          name: "integration",
          include: ["apps/**/*.itest.js", "packages/**/*.itest.js"],
          exclude: ["**/node_modules/**", "**/.next/**"],
          environment: "node",
          globalSetup: ["./test/globalSetup.js"],
          setupFiles: ["./test/loadTestEnv.js"],
          // DB tests share one Postgres; run them serially to avoid cross-test interference.
          fileParallelism: false,
        },
      },
    ],
  },
});
