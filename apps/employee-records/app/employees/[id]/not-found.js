import Link from "next/link";
import { getT } from "@/lib/i18n.server";

// Rendered when the page calls notFound() (no employee with that id).
export default async function NotFound() {
  const t = await getT();
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16 text-center">
      <h1 className="text-lg font-semibold">{t("notFound.employeeTitle")}</h1>
      <p className="mt-1 text-sm text-zinc-500">{t("notFound.employeeBody")}</p>
      <Link
        href="/employees"
        className="mt-4 inline-block text-sm text-blue-600 hover:underline dark:text-blue-400"
      >
        {t("notFound.back")}
      </Link>
    </main>
  );
}
