import { redirect } from "next/navigation";
import { CalendarDays, ClipboardList, CalendarClock, Clock } from "lucide-react";
import { getViewer, auth } from "@hris/auth";
import { getT } from "@/lib/i18n.server";
import { Card, Pill } from "@/components/profile-ui";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("home.title")} · FrogsAtWorkHR` };
}

// The four domains this app will grow into. Each is a placeholder card in M0; the matching
// milestone (M1 PTO → M2 Timesheets → M3 Scheduling → M4 Attendance) turns it into a real feature.
const DOMAINS = [
  { key: "timeOff", icon: CalendarDays },
  { key: "timesheets", icon: ClipboardList },
  { key: "schedule", icon: CalendarClock },
  { key: "attendance", icon: Clock },
];

export default async function HomePage() {
  // Belt-and-suspenders: proxy.js already gates this route, but resolve the viewer so the shell
  // is ready to branch on role as the domains land.
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const session = await auth();
  const t = await getT();
  const name = session?.user?.name ?? "";

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t("home.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {name ? t("home.greeting", { name }) : t("home.subtitle")}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {DOMAINS.map(({ key, icon: Icon }) => (
          <Card
            key={key}
            title={t(`home.card.${key}`)}
            action={<Pill>{t("home.comingSoon")}</Pill>}
          >
            <div className="flex items-start gap-3">
              <span className="rounded-lg bg-primary/10 p-2 text-primary">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <p className="text-sm text-muted-foreground">{t(`home.card.${key}Desc`)}</p>
            </div>
          </Card>
        ))}
      </div>
    </main>
  );
}
