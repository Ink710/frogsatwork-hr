import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getShiftForEdit } from "@/lib/queries";
import { getT } from "@/lib/i18n.server";
import { ShiftForm } from "@/components/ShiftForm";
import { DeleteShiftButton } from "@/components/DeleteShiftButton";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("schedule.editShift")} · FrogsAtWorkHR` };
}

export default async function EditShiftPage({ params }) {
  const { id } = await params;
  const [data, t] = await Promise.all([getShiftForEdit(id), getT()]);
  if (!data) notFound();

  return (
    <main className="mx-auto w-full max-w-xl px-6 py-10">
      <Link href="/schedule" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {t("schedule.title")}
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">{t("schedule.editShift")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{data.department?.name}</p>

      <div className="mt-6">
        <ShiftForm employees={data.employees} initial={data.shift} shiftId={data.shift.id} />
      </div>

      <div className="mt-6 border-t border-border pt-6">
        <DeleteShiftButton shiftId={data.shift.id} />
      </div>
    </main>
  );
}
