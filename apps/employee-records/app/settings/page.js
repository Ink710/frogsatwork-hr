import { notFound } from "next/navigation";
import { getViewer, canManageSettings } from "@hris/auth";
import { getStorageDir } from "@/lib/storage";
import { SettingsForm } from "@/components/SettingsForm";

export const metadata = { title: "Settings · PeopleBase" };

export default async function SettingsPage() {
  const viewer = await getViewer();
  if (!viewer || !canManageSettings(viewer)) notFound(); // HR_ADMIN only

  const storageDir = await getStorageDir();

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-zinc-500">Global configuration.</p>
      <SettingsForm storageDir={storageDir} />
    </main>
  );
}
