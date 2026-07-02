import { getOrgTree } from "@/lib/queries";
import { OrgNode } from "@/components/OrgNode";

export const metadata = { title: "Org chart · PeopleBase" };

export default async function OrgChartPage() {
  const roots = await getOrgTree();

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Org chart</h1>
        <p className="text-sm text-zinc-500">
          The current reporting structure — scoped to what you’re allowed to see.
        </p>
      </header>

      {roots.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 p-12 text-center text-sm text-zinc-500 dark:border-zinc-700">
          No visible employees.
        </div>
      ) : (
        // overflow-x-auto so a wide org can scroll horizontally without breaking layout.
        <div className="overflow-x-auto pb-6">
          <ul className="orgtree inline-flex justify-center">
            {roots.map((root) => (
              <OrgNode key={root.id} node={root} />
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
