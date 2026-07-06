import Link from "next/link";
import { prisma } from "@hris/database";
import { hashInviteToken } from "@/lib/invite";
import { SetPasswordForm } from "@/components/SetPasswordForm";

export const metadata = { title: "Set your password · PeopleBase" };

// Public page (excluded from the auth proxy). We verify the token on GET so an expired or
// already-used link shows a friendly message instead of a form that can't succeed. The raw
// token is passed through to the action via a hidden field; the DB only ever holds its hash.
export default async function SetPasswordPage({ searchParams }) {
  const params = await searchParams; // async in Next 16
  const token = typeof params?.token === "string" ? params.token : "";

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
      <p className="text-sm font-medium uppercase tracking-wide text-zinc-400">PeopleBase</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Set your password</h1>

      {user ? (
        <>
          <p className="mt-2 text-sm text-zinc-500">
            Welcome, {user.name}. Choose a password to activate your account.
          </p>
          <SetPasswordForm token={token} />
        </>
      ) : (
        <div className="mt-6 rounded-md bg-amber-50 px-3 py-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          <p className="font-medium">This link is invalid or has expired.</p>
          <p className="mt-1">Ask your HR contact to send a new invite.</p>
          <Link href="/login" className="mt-2 inline-block underline">
            Back to sign in
          </Link>
        </div>
      )}
    </main>
  );
}
