import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getViewer } from "@hris/auth";
import { getMeetingForManage } from "@/lib/queries";
import { getT } from "@/lib/i18n.server";
import { MeetingForm } from "@/components/MeetingForm";
import { MeetingAssignmentEditor } from "@/components/MeetingAssignmentEditor";
import { MeetingStatusButton } from "@/components/MeetingStatusButton";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("meetings.title")} · FrogsAtWorkHR` };
}

export default async function MeetingDetailPage({ params }) {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const { id } = await params;
  const [data, t] = await Promise.all([getMeetingForManage(id), getT()]);
  if (!data) notFound(); // not manageable by this viewer

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <Link href="/meetings" className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> {t("meetings.title")}
      </Link>

      <div className="mb-8 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{data.meeting.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(`enum.dayOfWeek.${data.meeting.dayOfWeek}`)} · <span className="font-mono tabular-nums">{data.meeting.startTime}–{data.meeting.endTime}</span>
          </p>
          <span
            className={`mt-2 inline-block rounded-md px-2 py-1 text-xs font-medium ${
              data.meeting.status === "ACTIVE" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"
            }`}
          >
            {t(`meetings.status.${data.meeting.status}`)}
          </span>
        </div>
        <MeetingStatusButton meetingId={data.meeting.id} status={data.meeting.status} />
      </div>

      {/* Edit name / weekday / time */}
      <section className="mb-10 rounded-xl border border-border bg-card p-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("meetings.details")}</h2>
        <MeetingForm meeting={data.meeting} />
      </section>

      {/* Assignments */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("meetings.assignees")}</h2>
        <MeetingAssignmentEditor meetingId={data.meeting.id} assignees={data.assignees} candidates={data.candidates} />
      </section>
    </main>
  );
}
