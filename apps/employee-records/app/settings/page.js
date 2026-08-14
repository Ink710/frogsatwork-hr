import { notFound } from "next/navigation";
import { getViewer, canManageSettings } from "@hris/auth";
import { getStorageDir } from "@/lib/storage";
import { getT } from "@/lib/i18n.server";
import { SettingsForm } from "@/components/SettingsForm";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("settings.title")} · FrogsAtWorkHR` };
}

export default async function SettingsPage() {
  const viewer = await getViewer();
  if (!viewer || !canManageSettings(viewer)) notFound(); // HR_ADMIN only

  const [storageDir, t] = await Promise.all([getStorageDir(), getT()]);
  // Which driver is actually in force. Read here rather than in the client component: env vars
  // aren't available in the browser, and the answer decides whether the directory field means
  // anything at all (see SettingsForm).
  const driver = process.env.STORAGE_DRIVER || "local";

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{t("settings.title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("settings.subtitle")}</p>
      <SettingsForm storageDir={storageDir} driver={driver} />
    </main>
  );
}
