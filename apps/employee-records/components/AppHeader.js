import Link from "next/link";
import { auth, signOut } from "@hris/auth";
import { humanize } from "@/lib/format";

// Async Server Component: reads the session server-side. Renders nothing when signed
// out (e.g. on /login), so the header only appears once authenticated.
export async function AppHeader() {
  const session = await auth();
  if (!session?.user) return null;

  const { name, role } = session.user;

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-5">
          <Link href="/employees" className="text-sm font-semibold tracking-tight">
            PeopleBase
          </Link>
          <nav className="flex items-center gap-4 text-sm text-zinc-500">
            <Link href="/employees" className="hover:text-zinc-900 dark:hover:text-zinc-100">Employees</Link>
            <Link href="/org-chart" className="hover:text-zinc-900 dark:hover:text-zinc-100">Org chart</Link>
          </nav>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-zinc-500">
            {name} · <span className="text-zinc-400">{humanize(role)}</span>
          </span>
          <form action={logout}>
            <button className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
