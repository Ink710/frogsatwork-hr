import path from "node:path";
import { prisma } from "@hris/database";
import { createStorage } from "@hris/storage";

// The base folder is a runtime setting (editable in /settings), falling back to STORAGE_DIR env,
// then a local .storage dir. Resolved per call so a settings change takes effect immediately (a
// single indexed lookup — negligible). The seed always writes a storageDir row, so the fallback is
// only a safety net.
async function resolveBaseDir() {
  const row = await prisma.appSetting.findUnique({ where: { key: "storageDir" } });
  const fallback = process.env.STORAGE_DIR || path.resolve(process.cwd(), ".storage");
  return row?.value || fallback;
}

// The swappable storage surface now lives in @hris/storage and is shared with the ATS (résumés).
// Driver comes from STORAGE_DRIVER (default "local"); this app supplies the runtime base dir.
export const storage = createStorage({ resolveBaseDir });

export async function getStorageDir() {
  return resolveBaseDir();
}
