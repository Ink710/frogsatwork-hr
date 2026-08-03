import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, ChevronLeft, ChevronRight, Pencil, ArrowLeftRight } from "lucide-react";
import { getViewer } from "@hris/auth";
import { formatHours } from "@hris/workable-hours";
import { getWeekSchedule } from "@/lib/queries";
import { getT, getLocale } from "@/lib/i18n.server";
import { PageTabs, myWeekTabs } from "@/components/PageTabs";
import { INTL_LOCALE } from "@/lib/i18n";
import { formatDate } from "@/lib/format";
import { PublishWeekButton } from "@/components/PublishWeekButton";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("schedule.title")} · FrogsAtWorkHR` };
}

function dayLabel(dateStr, locale) {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  return {
    weekday: new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(d),
    num: d.getUTCDate(),
    weekend: d.getUTCDay() === 0 || d.getUTCDay() === 6,
  };
}

export default async function SchedulePage({ searchParams }) {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const params = await searchParams;
  const [schedule, t, localeCode] = await Promise.all([getWeekSchedule(params?.week ?? null), getT(), getLocale()]);
  const locale = INTL_LOCALE[localeCode];

  if (!schedule) {
    return (
      <main className="mx-auto w-full max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">{t("schedule.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("schedule.noRecord")}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <PageTabs tabs={myWeekTabs(t)} active="/schedule" />
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("schedule.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {schedule.department?.name} · {formatDate(schedule.weekStart, locale)} – {formatDate(schedule.weekEnd, locale)}
          </p>
        </div>
        {schedule.canManage && (
          <div className="flex items-center gap-2">
            {schedule.hasDrafts && <PublishWeekButton weekStart={schedule.weekStart} />}
            <Link
              href={`/schedule/shift/new?week=${schedule.weekStart}`}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              <Plus className="h-4 w-4" aria-hidden="true" /> {t("schedule.addShift")}
            </Link>
          </div>
        )}
      </header>

      {/* Week nav */}
      <div className="mb-4 flex items-center justify-between text-sm">
        <Link href={`/schedule?week=${schedule.prevWeek}`} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> {t("schedule.prevWeek")}
        </Link>
        <Link href={`/schedule?week=${schedule.nextWeek}`} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
          {t("schedule.nextWeek")} <ChevronRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7">
        {schedule.days.map((day) => {
          const { weekday, num, weekend } = dayLabel(day.date, locale);
          return (
            <section key={day.date} className={`rounded-xl border border-border p-3 ${weekend ? "bg-muted/30" : "bg-card"}`}>
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{weekday}</span>
                <span className="text-sm font-medium font-mono tabular-nums">{num}</span>
              </div>
              {day.shifts.length === 0 ? (
                <p className="py-2 text-xs text-muted-foreground/60">—</p>
              ) : (
                <ul className="space-y-2">
                  {day.shifts.map((s) => (
                    <li
                      key={s.id}
                      className={`rounded-lg border p-2 text-xs ${s.published ? "border-border bg-background" : "border-dashed border-warning/50 bg-warning/5"} ${s.isMine ? "ring-1 ring-primary/40" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <span className="font-medium font-mono tabular-nums">{s.startTime}–{s.endTime}</span>
                        {schedule.canManage && (
                          <Link href={`/schedule/shift/${s.id}/edit`} className="shrink-0 text-muted-foreground hover:text-foreground" aria-label={t("schedule.edit")}>
                            <Pencil className="h-3 w-3" />
                          </Link>
                        )}
                      </div>
                      <p className={s.employeeName ? "text-foreground" : "italic text-muted-foreground"}>
                        {s.employeeName ?? t("schedule.open")}
                      </p>
                      {s.role && <p className="text-muted-foreground">{s.role}</p>}
                      <p className="mt-0.5 text-muted-foreground/70">
                        {formatHours(s.hours)}
                        {!s.published && ` · ${t("schedule.draft")}`}
                      </p>
                      {s.isMine && !schedule.canManage && s.published && (
                        <Link href={`/schedule/shift/${s.id}/swap`} className="mt-1 inline-flex items-center gap-1 text-primary hover:underline">
                          <ArrowLeftRight className="h-3 w-3" aria-hidden="true" /> {t("schedule.swap.request")}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}
