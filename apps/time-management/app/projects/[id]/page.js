import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getViewer } from "@hris/auth";
import { getProjectForManage } from "@/lib/queries";
import { getT } from "@/lib/i18n.server";
import { ProjectForm } from "@/components/ProjectForm";
import { AssignmentEditor } from "@/components/AssignmentEditor";
import { ProjectStatusButton } from "@/components/ProjectStatusButton";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("projects.title")} · FrogsAtWorkHR` };
}

export default async function ProjectDetailPage({ params }) {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const { id } = await params;
  const [data, t] = await Promise.all([getProjectForManage(id), getT()]);
  if (!data) notFound(); // not manageable by this viewer

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <Link href="/projects" className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> {t("projects.title")}
      </Link>

      <div className="mb-8 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {data.project.name}
            {data.project.code ? <span className="ml-2 font-mono text-base text-muted-foreground">{data.project.code}</span> : null}
          </h1>
          <span
            className={`mt-2 inline-block rounded-md px-2 py-1 text-xs font-medium ${
              data.project.status === "ACTIVE" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"
            }`}
          >
            {t(`projects.status.${data.project.status}`)}
          </span>
        </div>
        <ProjectStatusButton projectId={data.project.id} status={data.project.status} />
      </div>

      {/* Rename / recode */}
      <section className="mb-10 rounded-xl border border-border bg-card p-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("projects.details")}</h2>
        <ProjectForm project={data.project} />
      </section>

      {/* Assignments */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("projects.assignees")}</h2>
        <AssignmentEditor projectId={data.project.id} assignees={data.assignees} candidates={data.candidates} />
      </section>
    </main>
  );
}
