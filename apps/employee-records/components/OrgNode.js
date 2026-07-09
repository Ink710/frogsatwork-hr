import Link from "next/link";

// Recursive Server Component: renders one node, then maps its reports through ITSELF.
// That self-reference is the recursion — arbitrary org depth with no explicit loop. `t` is
// threaded down so every node can localize its report count.
//
// The complete org chart shows everyone's name/title (a directory), but a node is only a LINK to
// its profile when `node.linkable` — i.e. the viewer is actually allowed to open that record.
// A node the viewer can't open (e.g. a coworker, for a plain employee) renders as static text, so
// there are no dead links and no path to another person's personal information.
export function OrgNode({ node, t }) {
  const n = node.children.length;
  const hasReports = n > 0;

  const cardBase =
    "inline-flex w-44 flex-col items-center gap-1 rounded-xl border border-zinc-200 bg-white px-3 py-3 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-950";
  const inner = (
    <>
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
        {node.initials}
      </span>
      <span className="text-sm font-medium leading-tight">{node.name}</span>
      <span className="text-xs text-zinc-500 leading-tight">{node.title}</span>
      {node.department && (
        <span className="mt-0.5 rounded-full bg-zinc-50 px-2 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-900">
          {node.department}
        </span>
      )}
      {hasReports && (
        <span className="text-[10px] text-zinc-400">{t(n === 1 ? "org.report" : "org.reports", { n })}</span>
      )}
    </>
  );

  return (
    <li>
      {node.linkable ? (
        <Link
          href={`/employees/${node.id}`}
          className={`${cardBase} transition-colors hover:border-zinc-400 dark:hover:border-zinc-600`}
        >
          {inner}
        </Link>
      ) : (
        <div className={cardBase}>{inner}</div>
      )}

      {hasReports && (
        <ul>
          {node.children.map((child) => (
            <OrgNode key={child.id} node={child} t={t} />
          ))}
        </ul>
      )}
    </li>
  );
}
