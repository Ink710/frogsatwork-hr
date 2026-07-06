import path from "node:path";
import { prisma } from "@hris/database";
import { LocalStorage } from "./local.js";

// The base folder is a runtime setting (editable in /settings), falling back to
// STORAGE_DIR env, then a local .storage dir. Resolved per call so a settings change takes
// effect immediately (a single indexed lookup — negligible). The seed always writes a
// storageDir row, so the fallback is only a safety net.
async function resolveBaseDir() {
  const row = await prisma.appSetting.findUnique({ where: { key: "storageDir" } });
  const fallback = process.env.STORAGE_DIR || path.resolve(process.cwd(), ".storage");
  return row?.value || fallback;
}

// The swappable storage surface. Today it's local; a real S3/R2 adapter would implement
// the same three methods and be selected here (e.g. by a STORAGE_DRIVER setting).
export const storage = {
  async put(key, buffer) {
    return new LocalStorage(await resolveBaseDir()).put(key, buffer);
  },
  async getStream(key) {
    return new LocalStorage(await resolveBaseDir()).getStream(key);
  },
  async remove(key) {
    return new LocalStorage(await resolveBaseDir()).remove(key);
  },
};

export async function getStorageDir() {
  return resolveBaseDir();
}
