import Link from "next/link";
import { getT } from "@/lib/i18n.server";

// The confirmation shown after EVERY erasure request — matched, unmatched, duplicate, or filled in
// by a bot. The wording is conditional ("if we hold personal data matching that address…") because
// the page itself must not be able to answer the question "is this person in your database?".
// A separate route rather than in-place state, same as the apply confirmation: refreshing can't
// resubmit, and the back button lands somewhere sensible.
export default async function ErasureSubmittedPage() {
  const t = await getT();
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-20 text-center sm:px-6">
      <div className="rounded-xl border border-border bg-card p-10">
        <h1 className="text-2xl font-semibold tracking-tight">{t("erasure.submittedTitle")}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{t("erasure.submittedBody")}</p>
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
