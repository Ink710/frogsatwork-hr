import Link from "next/link";
import { getT } from "@/lib/i18n.server";
import { SiteHeader, SiteFooter } from "@/components/site-ui";

export const metadata = { title: "Check your email · FrogsAtWorkHR" };

// ⚠️ THE SAME PAGE FOR EVERY OUTCOME — found, unknown, erased, closed, throttled, or a mail failure.
// The wording is carefully conditional ("if we have an application for that address") because it has
// to be TRUE in all of those cases while confirming none of them. A page that said "we've sent you
// an email" would be a lie half the time, and the half it was true would be the leak.
export default async function LinkSentPage() {
  const t = await getT();
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-24">
        <h1 className="text-2xl font-semibold tracking-tight">{t("signin.sentTitle")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("signin.sentBody")}</p>
        <p className="mt-4 text-xs text-muted-foreground">{t("signin.sentHint")}</p>
        <Link href="/" className="mt-6 text-sm text-primary hover:underline">
          {t("careers.back")}
        </Link>
      </main>
      <SiteFooter />
    </>
  );
}
