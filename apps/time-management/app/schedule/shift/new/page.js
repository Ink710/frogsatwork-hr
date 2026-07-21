import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getShiftFormData } from "@/lib/queries";
import { getT } from "@/lib/i18n.server";
import { ShiftForm } from "@/components/ShiftForm";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("schedule.newShift")} · FrogsAtWorkHR` };
}

export default async function NewShiftPage({ searchParams }) {
  const [form, t, params] = await Promise.all([getShiftFormData(), getT(), searchParams]);
  if (!form) notFound(); // not a manager/HR with a department
  const defaultDate = params?.week ?? "";

  return (
    <main className="mx-auto w-full max-w-xl px-6 py-10">
      <Link href="/schedule" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {t("schedule.title")}
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">{t("schedule.newShift")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{form.department?.name}</p>
      <div className="mt-6">
        <ShiftForm employees={form.employees} defaultDate={defaultDate} />
      </div>
    </main>
  );
}
