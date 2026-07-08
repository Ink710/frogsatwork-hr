import Link from "next/link";

// App-wide 404. Rendered for unmatched URLs and for notFound() calls in routes without a
// more-specific not-found.js (e.g. /employees/[id]/not-found.js). Note: getX loaders that
// return null on an unauthorized viewer also land here — we don't reveal which.
export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16 text-center">
      <h1 className="text-lg font-semibold">Page not found</h1>
      <p className="mt-1 text-sm text-zinc-500">
        This page doesn’t exist, or you don’t have access to it.
      </p>
      <Link
        href="/employees"
        className="mt-4 inline-block text-sm text-blue-600 hover:underline dark:text-blue-400"
      >
        ← Back to employees
      </Link>
    </main>
  );
}
