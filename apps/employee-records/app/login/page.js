import { redirect } from "next/navigation";
import { signIn, AuthError } from "@hris/auth";
import { getT } from "@/lib/i18n.server";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("login.title")} · PeopleBase` };
}

export default async function LoginPage({ searchParams }) {
  const params = await searchParams; // async in Next 16
  const hasError = Boolean(params?.error);
  const justActivated = Boolean(params?.activated);
  const t = await getT();

  // Server Action: runs on the server, calls Auth.js signIn. On success, signIn throws
  // a NEXT_REDIRECT (to /employees) which must propagate; on bad credentials it throws
  // an AuthError, which we convert into a friendly ?error redirect.
  async function login(formData) {
    "use server";
    try {
      await signIn("credentials", {
        email: formData.get("email"),
        password: formData.get("password"),
        // Land on the home dispatcher, which routes by role (employee → own profile,
        // manager → their department, HR/payroll → the employee list).
        redirectTo: "/",
      });
    } catch (error) {
      if (error instanceof AuthError) {
        redirect("/login?error=CredentialsSignin");
      }
      throw error; // re-throw the redirect so a successful login actually navigates
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-24">
      <p className="text-sm font-medium uppercase tracking-wide text-zinc-400">PeopleBase</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">{t("login.title")}</h1>

      <form action={login} className="mt-6 space-y-4">
        {justActivated && !hasError && (
          <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950/30 dark:text-green-400">
            {t("login.activated")}
          </p>
        )}
        {hasError && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400">
            {t("login.invalid")}
          </p>
        )}
        <div>
          <label className="block text-sm font-medium" htmlFor="email">{t("login.email")}</label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="username"
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
        <div>
          <label className="block text-sm font-medium" htmlFor="password">{t("login.password")}</label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
        <button
          type="submit"
          className="w-full rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background hover:opacity-90"
        >
          {t("login.submit")}
        </button>
      </form>

      {/* Dev convenience — remove once real accounts exist. */}
      <div className="mt-8 rounded-md border border-dashed border-zinc-300 p-3 text-xs text-zinc-500 dark:border-zinc-700">
        <p className="font-medium">{t("login.seededHint")}</p>
        <ul className="mt-1 space-y-0.5">
          <li>ana.okafor@peoplebase.test — HR Admin (sees all)</li>
          <li>marcus.lee@peoplebase.test — Manager (his team)</li>
          <li>diego.santos@peoplebase.test — Employee (only self)</li>
        </ul>
      </div>
    </main>
  );
}
