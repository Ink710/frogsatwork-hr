// Runs (as a Vitest setupFile) before each integration test file's imports, so the
// @hris/database client constructs its adapter against hris_test, not the dev DB.
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

config({ path: fileURLToPath(new URL("../.env.test", import.meta.url)) });
