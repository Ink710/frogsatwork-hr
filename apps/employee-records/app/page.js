import Link from "next/link";
import { getT } from "@/lib/i18n.server";

export default async function Home() {
  const t = await getT();
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-6 py-24">
      <p className="text-sm font-medium uppercase tracking-wide text-zinc-400">PeopleBase</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">{t("home.title")}</h1>
      <p className="mt-3 max-w-md text-zinc-600 dark:text-zinc-400">{t("home.subtitle")}</p>
      <Link
        href="/employees"
        className="mt-6 inline-flex w-fit items-center rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-colors hover:opacity-90"
      >
        {t("home.cta")}
      </Link>
    </main>
  );
}
