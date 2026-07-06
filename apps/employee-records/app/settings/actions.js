"use server";

import { revalidatePath } from "next/cache";
import { getViewer, canManageSettings } from "@hris/auth";
import { prisma } from "@hris/database";

// Update the storage folder. HR_ADMIN only. AppSetting has no RLS (non-sensitive config),
// so the gate here is the authority.
export async function setStorageDir(_prevState, formData) {
  const viewer = await getViewer();
  if (!viewer || !canManageSettings(viewer)) return { error: "You are not authorized." };

  const dir = String(formData.get("storageDir") ?? "").trim();
  if (!dir) return { error: "A folder path is required." };

  await prisma.appSetting.upsert({
    where: { key: "storageDir" },
    update: { value: dir },
    create: { key: "storageDir", value: dir },
  });
  revalidatePath("/settings");
  return { ok: true, value: dir };
}
