import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { FolderKanban, ChevronRight } from "lucide-react";
import { getViewer } from "@hris/auth";
import { getManagedProjects } from "@/lib/queries";
import { getT } from "@/lib/i18n.server";
import { PageTabs, activitiesTabs } from "@/components/PageTabs";
import { ProjectForm } from "@/components/ProjectForm";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("projects.title")} · FrogsAtWorkHR` };
}

export default async function ProjectsPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const [projects, t] = await Promise.all([getManagedProjects(), getT()]);
  if (!projects) notFound(); // non-manager

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <PageTabs tabs={activitiesTabs(t)} active="/projects" />
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t("projects.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("projects.subtitle")}</p>
      </header>

      {/* Create */}
      <section className="mb-10 rounded-xl border border-border bg-card p-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t("projects.newProject")}
        </h2>
        <ProjectForm />
      </section>

      {/* Managed projects */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <FolderKanban className="h-4 w-4" aria-hidden="true" />
          {t("projects.yours")}
        </h2>
        {projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("projects.none")}</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {projects.map((p) => (
              <li key={p.id}>
                <Link href={`/projects/${p.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted">
                  <div>
                    <p className="text-sm font-medium">
                      {p.name}
                      {p.code ? <span className="ml-2 font-mono text-xs text-muted-foreground">{p.code}</span> : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("projects.assigneeCount", { count: String(p.assigneeCount) })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-md px-2 py-1 text-xs font-medium ${
                        p.status === "ACTIVE" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {t(`projects.status.${p.status}`)}
                    </span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
