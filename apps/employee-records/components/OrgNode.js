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
    "inline-flex w-44 flex-col items-center gap-1 rounded-xl border border-border bg-card px-3 py-3 text-center shadow-sm  ";
  const inner = (
    <>
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground  dark:text-muted-foreground/50">
        {node.initials}
      </span>
      <span className="text-sm font-medium leading-tight">{node.name}</span>
      <span className="text-xs text-muted-foreground leading-tight">{node.title}</span>
      {node.department && (
        <span className="mt-0.5 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground ">
          {node.department}
        </span>
      )}
      {hasReports && (
        <span className="text-[10px] text-muted-foreground">{t(n === 1 ? "org.report" : "org.reports", { n })}</span>
      )}
    </>
  );

  return (
    <li>
      {node.linkable ? (
        <Link
          href={`/employees/${node.id}`}
          className={`${cardBase} transition-colors hover:border-ring`}
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
