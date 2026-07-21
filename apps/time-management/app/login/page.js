import { redirect } from "next/navigation";
import { signIn, AuthError } from "@hris/auth";
import { getT } from "@/lib/i18n.server";
import { Logo } from "@/components/Logo";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("login.title")} · FrogsAtWorkHR` };
}

export default async function LoginPage({ searchParams }) {
  const params = await searchParams; // async in Next 16
  const hasError = Boolean(params?.error);
  const justActivated = Boolean(params?.activated);
  const t = await getT();

  // Server Action: runs on the server, calls Auth.js signIn. On success, signIn throws
  // a NEXT_REDIRECT (to the home dispatcher) which must propagate; on bad credentials it throws
  // an AuthError, which we convert into a friendly ?error redirect.
  async function login(formData) {
    "use server";
    try {
      await signIn("credentials", {
        email: formData.get("email"),
        password: formData.get("password"),
        redirectTo: "/",
      });
    } catch (error) {
      if (error instanceof AuthError) {
        redirect("/login?error=CredentialsSignin");
      }
      throw error; // re-throw the redirect so a successful login actually navigates
    }
  }

  const inputCls =
    "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-24">
      <Logo href="/login" size={40} wordmark={false} />
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">
        Frogs<span className="text-primary">AtWork</span>HR
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("brand.slogan")}</p>

      <form action={login} className="mt-8 space-y-4">
        {justActivated && !hasError && (
          <p className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">
            {t("login.activated")}
          </p>
        )}
        {hasError && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {t("login.invalid")}
          </p>
        )}
        <div>
          <label className="block text-sm font-medium" htmlFor="email">{t("login.email")}</label>
          <input id="email" name="email" type="email" required autoComplete="username" className={inputCls} />
        </div>
        <div>
          <label className="block text-sm font-medium" htmlFor="password">{t("login.password")}</label>
          <input id="password" name="password" type="password" required autoComplete="current-password" className={inputCls} />
        </div>
        <button
          type="submit"
          className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          {t("login.submit")}
        </button>
      </form>

      {/* Dev convenience — remove once real accounts exist. */}
      <div className="mt-8 rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
        <p className="font-medium">{t("login.seededHint")}</p>
        <ul className="mt-1 space-y-0.5">
          <li>ana.okafor@frogsatwork.test — HR Admin (sees all)</li>
          <li>marcus.lee@frogsatwork.test — Manager (his team)</li>
          <li>diego.santos@frogsatwork.test — Employee (only self)</li>
        </ul>
      </div>
    </main>
  );
}
