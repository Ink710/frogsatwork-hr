import Link from "next/link";
import { getT } from "@/lib/i18n.server";

// App-wide 404. Rendered for unmatched URLs and for notFound() calls in routes without a more-specific
// not-found.js (e.g. the attendance/team + correct pages). Note: loaders that return null on an
// unauthorized viewer also land here — we don't reveal which.
export default async function NotFound() {
  const t = await getT();
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16 text-center">
      <h1 className="text-lg font-semibold">{t("notFound.title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("notFound.body")}</p>
      <Link href="/" className="mt-4 inline-block text-sm text-primary hover:underline">
        {t("notFound.back")}
      </Link>
    </main>
  );
}
