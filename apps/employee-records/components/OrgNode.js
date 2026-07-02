import Link from "next/link";

// Recursive Server Component: renders one node, then maps its reports through ITSELF.
// That self-reference is the recursion — arbitrary org depth with no explicit loop.
export function OrgNode({ node }) {
  const hasReports = node.children.length > 0;

  return (
    <li>
      <Link
        href={`/employees/${node.id}`}
        className="inline-flex w-44 flex-col items-center gap-1 rounded-xl border border-zinc-200 bg-white px-3 py-3 text-center shadow-sm transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600"
      >
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
          <span className="text-[10px] text-zinc-400">
            {node.children.length} report{node.children.length === 1 ? "" : "s"}
          </span>
        )}
      </Link>

      {hasReports && (
        <ul>
          {node.children.map((child) => (
            <OrgNode key={child.id} node={child} />
          ))}
        </ul>
      )}
    </li>
  );
}
