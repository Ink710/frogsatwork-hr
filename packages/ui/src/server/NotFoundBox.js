import Link from "next/link";

// The shared 404 CHROME. Purely presentational — each app's `app/not-found.js` supplies its own
// translated strings and back-link (the apps disagree on where "back" goes).
export function NotFoundBox({ title, body, backHref = "/", backLabel }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16 text-center">
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      <Link href={backHref} className="mt-4 inline-block text-sm text-primary hover:underline">
        {backLabel}
      </Link>
    </main>
  );
}
