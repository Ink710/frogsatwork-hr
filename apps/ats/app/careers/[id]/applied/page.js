import Link from "next/link";
import { getT } from "@/lib/i18n.server";

// A separate confirmation ROUTE (rather than in-place state) so refreshing can't resubmit, and the
// back button lands somewhere sensible.
export default async function AppliedPage() {
  const t = await getT();
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-20 text-center sm:px-6">
      <div className="rounded-xl border border-border bg-card p-10">
        <h1 className="text-2xl font-semibold tracking-tight">{t("applied.title")}</h1>
        <p className="mt-3 text-sm text-muted-foreground">{t("applied.body")}</p>
        <Link
          href="/careers"
          className="mt-6 inline-block rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          {t("applied.more")}
        </Link>
      </div>
    </main>
  );
}
