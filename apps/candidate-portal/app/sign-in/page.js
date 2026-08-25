import { getT } from "@/lib/i18n.server";
import { SiteHeader, SiteFooter } from "@/components/site-ui";
import { SignInForm } from "@/components/SignInForm";

export const metadata = { title: "Sign in · FrogsAtWorkHR" };

// PUBLIC. There is no registration anywhere in this app — an account exists only for someone who
// has actually applied, and it is created the first time they ask for a link. So this page asks for
// one thing and makes no promises about whether it will find anything.
export default async function SignInPage() {
  const t = await getT();
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-24">
        <h1 className="text-2xl font-semibold tracking-tight">{t("signin.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("signin.subtitle")}</p>
        <SignInForm />
      </main>
      <SiteFooter />
    </>
  );
}
