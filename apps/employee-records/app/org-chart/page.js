import { getOrgChart } from "@/lib/queries";
import { getT } from "@/lib/i18n.server";
import { OrgNode } from "@/components/OrgNode";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("org.title")} · FrogsAtWorkHR` };
}

export default async function OrgChartPage() {
  const [roots, t] = await Promise.all([getOrgChart(), getT()]);

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t("org.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("org.subtitle")}</p>
      </header>

      {roots.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center text-sm text-muted-foreground ">
          {t("org.empty")}
        </div>
      ) : (
        // overflow-x-auto so a wide org can scroll horizontally without breaking layout.
        <div className="overflow-x-auto pb-6">
          <ul className="orgtree inline-flex justify-center">
            {roots.map((root) => (
              <OrgNode key={root.id} node={root} t={t} />
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
