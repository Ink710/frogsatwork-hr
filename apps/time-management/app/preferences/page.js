import { redirect } from "next/navigation";
import { getViewer } from "@hris/auth";
import { getT } from "@/lib/i18n.server";
import { Card } from "@/components/profile-ui";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LanguageToggle } from "@/components/LanguageToggle";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("prefs.title")} · FrogsAtWorkHR` };
}

// Per-user preferences — available to every signed-in user (unlike /settings, which is HR-only
// global config).
export default async function PreferencesPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const t = await getT();

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{t("prefs.title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground dark:text-muted-foreground">{t("prefs.subtitle")}</p>

      <div className="mt-6 space-y-6">
        <Card title={t("prefs.appearance")}>
          <p className="mb-4 text-sm text-muted-foreground dark:text-muted-foreground">{t("prefs.appearanceHelp")}</p>
          <ThemeToggle />
        </Card>

        <Card title={t("prefs.language")}>
          <p className="mb-4 text-sm text-muted-foreground dark:text-muted-foreground">{t("prefs.languageHelp")}</p>
          <LanguageToggle />
        </Card>
      </div>
    </main>
  );
}
