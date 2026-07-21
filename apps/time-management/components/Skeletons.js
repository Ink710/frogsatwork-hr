// Reusable loading skeletons. Pure server-safe markup — each route's loading.js renders
// <LoadingPage variant=…/> so the fallbacks stay consistent and one-line thin. Next wraps
// each route in a <Suspense> boundary using its loading.js as the fallback while the async
// Server Component awaits its data.

function Bar({ className = "" }) {
  return <div className={`animate-pulse rounded bg-muted  ${className}`} />;
}
function Soft({ className = "" }) {
  return <div className={`animate-pulse rounded bg-muted  ${className}`} />;
}

function FieldRows({ count = 6 }) {
  return (
    <div className="max-w-lg space-y-5">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Soft className="h-4 w-28" />
          <Soft className="h-10" />
        </div>
      ))}
      <Soft className="h-10 w-32" />
    </div>
  );
}

// variant: "list" | "cards" | "stats" | "form" | "tree" | "detail"
export function LoadingPage({ variant = "list", width = "max-w-5xl" }) {
  return (
    <main className={`mx-auto w-full ${width} px-6 py-10`} aria-busy="true">
      <div className="mb-8 space-y-2">
        <Bar className="h-8 w-48" />
        <Soft className="h-4 w-32" />
      </div>

      {variant === "list" && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Soft key={i} className="h-11" />
          ))}
        </div>
      )}

      {variant === "cards" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Soft key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      )}

      {variant === "stats" && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Soft key={i} className="h-24 rounded-xl" />
            ))}
          </div>
          <div className="mt-10 grid grid-cols-1 gap-10 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Soft key={i} className="h-40 rounded-lg" />
            ))}
          </div>
        </>
      )}

      {variant === "form" && <FieldRows />}

      {variant === "tree" && (
        <div className="flex justify-center">
          <Soft className="h-48 w-full max-w-4xl rounded-lg" />
        </div>
      )}

      {variant === "detail" && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Soft key={i} className="h-20 rounded-xl" />
            ))}
          </div>
          <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-2">
            <Soft className="h-56 rounded-lg" />
            <Soft className="h-56 rounded-lg" />
          </div>
        </>
      )}
    </main>
  );
}
