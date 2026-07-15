import Link from "next/link";
import { prisma } from "@hris/database";
import { hashInviteToken } from "@/lib/invite";
import { getT } from "@/lib/i18n.server";
import { SetPasswordForm } from "@/components/SetPasswordForm";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("setpw.title")} · FrogsAtWorkHR` };
}

// Public page (excluded from the auth proxy). We verify the token on GET so an expired or
// already-used link shows a friendly message instead of a form that can't succeed. The raw
// token is passed through to the action via a hidden field; the DB only ever holds its hash.
export default async function SetPasswordPage({ searchParams }) {
  const params = await searchParams; // async in Next 16
  const token = typeof params?.token === "string" ? params.token : "";
  const t = await getT();

  const user = token
    ? await prisma.user.findFirst({
        where: {
          inviteTokenHash: hashInviteToken(token),
          inviteTokenExpires: { gt: new Date() },
          emailVerifiedAt: null,
        },
        select: { name: true },
      })
    : null;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-24">
      <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">FrogsAtWorkHR</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">{t("setpw.title")}</h1>

      {user ? (
        <>
          <p className="mt-2 text-sm text-muted-foreground">{t("setpw.welcome", { name: user.name })}</p>
          <SetPasswordForm token={token} />
        </>
      ) : (
        <div className="mt-6 rounded-md bg-warning/10 px-3 py-3 text-sm text-warning  ">
          <p className="font-medium">{t("setpw.invalid")}</p>
          <p className="mt-1">{t("setpw.invalidHelp")}</p>
          <Link href="/login" className="mt-2 inline-block underline">
            {t("setpw.backToSignIn")}
          </Link>
        </div>
      )}
    </main>
  );
}
