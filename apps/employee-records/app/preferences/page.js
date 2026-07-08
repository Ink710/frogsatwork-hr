import { redirect } from "next/navigation";
import { getViewer } from "@hris/auth";
import { Card } from "@/components/profile-ui";
import { ThemeToggle } from "@/components/ThemeToggle";

export const metadata = { title: "Preferences · PeopleBase" };

// Per-user preferences — available to every signed-in user (unlike /settings, which is HR-only
// global config).
export default async function PreferencesPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Preferences</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Personal settings for your account, saved in this browser.
      </p>

      <div className="mt-6">
        <Card title="Appearance">
          <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
            Choose how PeopleBase looks. <span className="font-medium">System</span> follows your
            device&rsquo;s light/dark setting.
          </p>
          <ThemeToggle />
        </Card>
      </div>
    </main>
  );
}
