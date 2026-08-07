"use client";

import { useActionState } from "react";
import { useT } from "@hris/ui/client";
import { addJobMember, removeJobMember } from "@/app/(internal)/jobs/actions";

const INPUT =
  "rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";

function MemberRow({ jobId, member }) {
  const t = useT();
  const [state, action, pending] = useActionState(removeJobMember.bind(null, jobId, member.id), undefined);

  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">
            {member.name}
            {member.jobTitle && <span className="ml-2 text-xs text-muted-foreground">{member.jobTitle}</span>}
          </p>
          <p className="text-xs text-muted-foreground">{t(`enum.jobMemberRole.${member.role}`)}</p>
        </div>
        <form action={action}>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-60"
          >
            {t("team.remove")}
          </button>
        </form>
      </div>
      {state?.error && <p className="mt-1 text-xs text-destructive">{state.error}</p>}
    </li>
  );
}

export function TeamEditor({ jobId, members, assignable, roles }) {
  const t = useT();
  const [state, action, pending] = useActionState(addJobMember.bind(null, jobId), undefined);
  // Don't offer people already on the team — the action also refuses duplicates server-side.
  const taken = new Set(members.map((m) => m.employeeId));
  const options = assignable.filter((e) => !taken.has(e.id));

  return (
    <div>
      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("team.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {members.map((m) => (
            <MemberRow key={m.id} jobId={jobId} member={m} />
          ))}
        </ul>
      )}

      <form action={action} className="mt-4 flex flex-wrap items-center gap-2">
        <select name="employeeId" required aria-label={t("team.employee")} className={`${INPUT} flex-1`} defaultValue="">
          <option value="" disabled>
            {t("team.employee")}
          </option>
          {options.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
              {e.jobTitle ? ` — ${e.jobTitle}` : ""}
            </option>
          ))}
        </select>
        <select name="role" aria-label={t("team.role")} className={INPUT} defaultValue="INTERVIEWER">
          {roles.map((r) => (
            <option key={r} value={r}>
              {t(`enum.jobMemberRole.${r}`)}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {t("team.add")}
        </button>
      </form>
      {state?.error && <p className="mt-1 text-xs text-destructive">{state.error}</p>}
    </div>
  );
}
