"use client";

// The shared error-boundary CHROME. Client-side because it owns the retry button (and React error
// boundaries are client components by definition). Strings are passed in already translated — each
// app's `app/error.js` stays a thin wrapper that calls useT() and renders this.
export function ErrorBox({
  title,
  message,
  actionLabel,
  onReset,
  className = "mx-auto w-full max-w-3xl px-6 py-16",
}) {
  return (
    <main className={className}>
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6">
        <h2 className="text-lg font-semibold text-destructive">{title}</h2>
        <p className="mt-1 text-sm text-destructive">{message}</p>
        <button
          onClick={onReset}
          className="mt-4 rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-white hover:bg-destructive/90"
        >
          {actionLabel}
        </button>
      </div>
    </main>
  );
}
