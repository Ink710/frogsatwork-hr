import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The employee-records app uses the Next "@/*" import alias (apps/employee-records/*).
// Each Vitest project needs its own resolve config — the root one doesn't propagate.
const appAlias = {
  "@": fileURLToPath(new URL("./apps/employee-records", import.meta.url)),
  // `server-only` throws under bare Node (default export condition); stub it to a no-op so
  // server modules can be exercised in tests. Next resolves it correctly at build time.
  "server-only": fileURLToPath(new URL("./test/server-only-stub.js", import.meta.url)),
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias: appAlias },
        test: {
          name: "unit",
          include: ["packages/**/src/**/*.test.js", "apps/**/lib/**/*.test.js"],
          exclude: ["**/node_modules/**", "**/.next/**", "**/*.itest.js"],
          environment: "node",
        },
      },
      {
        resolve: { alias: appAlias },
        test: {
          name: "integration",
          include: ["apps/**/*.itest.js", "packages/**/*.itest.js"],
          exclude: ["**/node_modules/**", "**/.next/**"],
          environment: "node",
          globalSetup: ["./test/globalSetup.js"],
          setupFiles: ["./test/loadTestEnv.js"],
          fileParallelism: false,
        },
      },
    ],
  },
});
