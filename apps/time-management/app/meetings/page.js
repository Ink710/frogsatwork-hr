import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { CalendarClock, ChevronRight } from "lucide-react";
import { getViewer } from "@hris/auth";
import { getManagedMeetings } from "@/lib/queries";
import { getT } from "@/lib/i18n.server";
import { MeetingForm } from "@/components/MeetingForm";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("meetings.title")} · FrogsAtWorkHR` };
}

export default async function MeetingsPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const [meetings, t] = await Promise.all([getManagedMeetings(), getT()]);
  if (!meetings) notFound(); // non-manager

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t("meetings.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("meetings.subtitle")}</p>
      </header>

      {/* Create */}
      <section className="mb-10 rounded-xl border border-border bg-card p-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t("meetings.newMeeting")}
        </h2>
        <MeetingForm />
      </section>

      {/* Managed meetings */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <CalendarClock className="h-4 w-4" aria-hidden="true" />
          {t("meetings.yours")}
        </h2>
        {meetings.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("meetings.none")}</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {meetings.map((m) => (
              <li key={m.id}>
                <Link href={`/meetings/${m.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted">
                  <div>
                    <p className="text-sm font-medium">{m.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t(`enum.dayOfWeek.${m.dayOfWeek}`)} · <span className="font-mono tabular-nums">{m.startTime}–{m.endTime}</span>
                      {" · "}
                      {t("meetings.assigneeCount", { count: String(m.assigneeCount) })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-md px-2 py-1 text-xs font-medium ${
                        m.status === "ACTIVE" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {t(`meetings.status.${m.status}`)}
                    </span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
