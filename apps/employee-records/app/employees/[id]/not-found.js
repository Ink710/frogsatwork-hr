import Link from "next/link";

// Rendered when the page calls notFound() (no employee with that id).
export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16 text-center">
      <h1 className="text-lg font-semibold">Employee not found</h1>
      <p className="mt-1 text-sm text-zinc-500">
        This record doesn’t exist or may have been removed.
      </p>
      <Link
        href="/employees"
        className="mt-4 inline-block text-sm text-blue-600 hover:underline dark:text-blue-400"
      >
        ← Back to all employees
      </Link>
    </main>
  );
}
