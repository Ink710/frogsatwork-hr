import { notFound } from "next/navigation";
import { getViewer, canManageSettings } from "@hris/auth";
import { getStorageDir } from "@/lib/storage";
import { getT } from "@/lib/i18n.server";
import { SettingsForm } from "@/components/SettingsForm";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("settings.title")} · PeopleBase` };
}

export default async function SettingsPage() {
  const viewer = await getViewer();
  if (!viewer || !canManageSettings(viewer)) notFound(); // HR_ADMIN only

  const [storageDir, t] = await Promise.all([getStorageDir(), getT()]);

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{t("settings.title")}</h1>
      <p className="mt-1 text-sm text-zinc-500">{t("settings.subtitle")}</p>
      <SettingsForm storageDir={storageDir} />
    </main>
  );
}
