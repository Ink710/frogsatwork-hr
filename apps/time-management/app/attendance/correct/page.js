import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getViewer } from "@hris/auth";
import { getCorrectionTarget } from "@/lib/queries";
import { getT } from "@/lib/i18n.server";
import { ClockCorrectionForm } from "@/components/ClockCorrectionForm";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("attendance.correct.title")} · FrogsAtWorkHR` };
}

export default async function CorrectAttendancePage({ searchParams }) {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const params = await searchParams;
  const [target, t] = await Promise.all([getCorrectionTarget(params?.employeeId ?? null), getT()]);
  if (!target) notFound(); // not an approver, or not allowed to act on this subject

  const backDate = params?.date ?? "";

  return (
    <main className="mx-auto w-full max-w-lg px-6 py-10">
      <Link
        href={`/attendance/team${backDate ? `?date=${backDate}` : ""}`}
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> {t("attendance.team.title")}
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">{t("attendance.correct.title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("attendance.correct.help", { name: target.name })}</p>

      <ClockCorrectionForm employeeId={target.id} defaultDate={backDate} />
    </main>
  );
}
