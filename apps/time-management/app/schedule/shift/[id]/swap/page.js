import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getSwapForm } from "@/lib/queries";
import { getT, getLocale } from "@/lib/i18n.server";
import { INTL_LOCALE } from "@/lib/i18n";
import { formatDate } from "@/lib/format";
import { SwapRequestForm } from "@/components/SwapRequestForm";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("schedule.swap.title")} · FrogsAtWorkHR` };
}

export default async function SwapShiftPage({ params }) {
  const { id } = await params;
  const [data, t, localeCode] = await Promise.all([getSwapForm(id), getT(), getLocale()]);
  if (!data) notFound(); // not the viewer's own shift
  const locale = INTL_LOCALE[localeCode];

  return (
    <main className="mx-auto w-full max-w-xl px-6 py-10">
      <Link href="/schedule" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {t("schedule.title")}
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">{t("schedule.swap.title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {formatDate(data.shift.date, locale)} · {data.shift.start}–{data.shift.end}
      </p>
      <p className="mt-4 text-sm text-muted-foreground">{t("schedule.swap.help")}</p>
      <div className="mt-4">
        <SwapRequestForm shiftId={data.shift.id} targets={data.targets} />
      </div>
    </main>
  );
}
