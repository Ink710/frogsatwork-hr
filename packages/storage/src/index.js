import path from "node:path";
import { LocalStorage } from "./local.js";

// @hris/storage — the suite's swappable object storage.
//
// Every driver implements the same three-method surface:
//   put(key, buffer) · getStream(key) · remove(key)
// so calling code never knows or cares where bytes actually live.
//
// WHY MORE THAN ONE DRIVER: the local filesystem is perfect for development and tests, but it does
// NOT work on serverless hosting (Vercel's filesystem is ephemeral and read-only), so a real
// deployment needs object storage. Those services cost money, and the account belongs to whoever
// runs the app — so the suite ships the SEAM, fully wired, and leaves the credentials to the
// operator. `local` is functional; the cloud drivers are declared and throw a clear, actionable
// error until configured. Swapping one in is a single file, no calling code changes.
//
// Select with STORAGE_DRIVER (default "local"). See the README's "Storage drivers" section.

export const STORAGE_DRIVERS = ["local", "s3", "r2", "vercel-blob"];

// A driver that exists in the interface but has no implementation shipped here. It fails loudly and
// tells the operator exactly what to do, rather than silently dropping files.
function unconfiguredDriver(name, envHint) {
  const explain = () => {
    throw new Error(
      `Storage driver "${name}" is declared but not configured. Implement it in @hris/storage ` +
        `and provide ${envHint}, or set STORAGE_DRIVER=local for filesystem storage.`,
    );
  };
  return { put: explain, getStream: explain, remove: explain };
}

const CLOUD_HINTS = {
  s3: "STORAGE_BUCKET + AWS credentials",
  r2: "STORAGE_BUCKET + Cloudflare R2 credentials",
  "vercel-blob": "BLOB_READ_WRITE_TOKEN",
};

// The base folder for the local driver. `resolveBaseDir` is injected by the app (employee-records
// reads a runtime AppSetting so a change in /settings takes effect immediately); when absent we fall
// back to STORAGE_DIR or a .storage folder beside the process.
function defaultBaseDir() {
  return process.env.STORAGE_DIR || path.resolve(process.cwd(), ".storage");
}

/**
 * Build a storage handle.
 * @param {object} [opts]
 * @param {() => Promise<string>} [opts.resolveBaseDir] async base-dir resolver for the local driver.
 * @param {string} [opts.driver] override STORAGE_DRIVER (mainly for tests).
 */
export function createStorage({ resolveBaseDir, driver } = {}) {
  const name = driver || process.env.STORAGE_DRIVER || "local";

  if (name !== "local") {
    if (!STORAGE_DRIVERS.includes(name)) {
      throw new Error(`Unknown STORAGE_DRIVER "${name}". Expected one of: ${STORAGE_DRIVERS.join(", ")}.`);
    }
    return unconfiguredDriver(name, CLOUD_HINTS[name]);
  }

  const baseDir = resolveBaseDir ?? (async () => defaultBaseDir());
  return {
    async put(key, buffer) {
      return new LocalStorage(await baseDir()).put(key, buffer);
    },
    async getStream(key) {
      return new LocalStorage(await baseDir()).getStream(key);
    },
    async remove(key) {
      return new LocalStorage(await baseDir()).remove(key);
    },
  };
}

export { LocalStorage };
