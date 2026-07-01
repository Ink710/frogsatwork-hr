// Prisma 7 configuration. Used by the Prisma CLI (migrate, studio, db seed).
//
// This file lives in packages/database. The project keeps a single .env at the
// monorepo root, so we load it explicitly (dotenv otherwise only looks in cwd).
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { defineConfig, env } from "prisma/config";

loadEnv({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // `prisma db seed` runs this. The seed connects as the restricted app role.
    seed: "node src/seed.js",
  },
  datasource: {
    // Migrate/Studio connect as the OWNER role (DIRECT_URL) so they can create
    // tables and run privileged GRANT/REVOKE SQL. The runtime client uses the
    // restricted role instead (see src/client.js).
    url: env("DIRECT_URL"),
  },
});
