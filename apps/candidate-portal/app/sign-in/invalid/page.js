import Link from "next/link";
import { getT } from "@/lib/i18n.server";
import { SiteHeader, SiteFooter } from "@/components/site-ui";

export const metadata = { title: "That link didn't work · FrogsAtWorkHR" };

// Where /sign-in/verify sends someone whose link was unknown, expired, already used, or belongs to a
// closed account. ONE message for all four: which it was would tell a stranger holding a bad link
// something about whose link it is.
export default async function InvalidLinkPage() {
  const t = await getT();
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-24">
        <h1 className="text-2xl font-semibold tracking-tight">{t("signin.invalidTitle")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("signin.invalidBody")}</p>
        <Link href="/sign-in" className="mt-6 text-sm text-primary hover:underline">
          {t("signin.requestAnother")}
        </Link>
      </main>
      <SiteFooter />
    </>
  );
}
