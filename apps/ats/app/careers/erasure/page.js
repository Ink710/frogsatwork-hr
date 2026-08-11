import { getT } from "@/lib/i18n.server";
import { ErasureRequestForm } from "@/components/ErasureRequestForm";

// The public "erase my data" page — the second unauthenticated surface in the suite, and the only
// one whose whole job is to give someone a way OUT of the database.
//
// It sits under /careers so it inherits the brand-only public layout and, like the rest of that
// route group, is excluded from the auth proxy matcher.
export default async function ErasureRequestPage() {
  const t = await getT();
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("erasure.title")}</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{t("erasure.intro")}</p>
      <div className="mt-8 rounded-xl border border-border bg-card p-6">
        <ErasureRequestForm />
      </div>
    </main>
  );
}
