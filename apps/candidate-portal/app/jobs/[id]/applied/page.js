import Link from "next/link";
import { getT } from "@/lib/i18n.server";
import { SiteHeader, SiteFooter } from "@/components/site-ui";

export const metadata = { title: "Application received · FrogsAtWorkHR" };

export default async function AppliedPage() {
  const t = await getT();
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-24">
        <h1 className="text-2xl font-semibold tracking-tight">{t("applied.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("applied.body")}</p>
        {/* The pitch for having an account, at the one moment it is obviously useful. */}
        <Link href="/sign-in" className="mt-6 text-sm text-primary hover:underline">
          {t("applied.track")}
        </Link>
        <Link href="/" className="mt-2 text-sm text-muted-foreground hover:text-foreground">
          {t("careers.back")}
        </Link>
      </main>
      <SiteFooter />
    </>
  );
}
