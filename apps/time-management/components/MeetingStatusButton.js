"use client";

import { useActionState } from "react";
import { useT } from "@/components/LocaleProvider";
import { toggleMeetingStatus } from "@/app/meetings/actions";

// Archive an ACTIVE meeting or reactivate an ARCHIVED one. Archived meetings drop out of the employee
// timesheet picker but keep their historical time entries. Mirrors ProjectStatusButton.
export function MeetingStatusButton({ meetingId, status }) {
  const t = useT();
  const [state, action, pending] = useActionState(toggleMeetingStatus.bind(null, meetingId), undefined);
  const archiving = status === "ACTIVE";

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <button
        type="submit"
        disabled={pending}
        className={`rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-60 ${
          archiving ? "border-border hover:bg-muted" : "border-primary/40 text-primary hover:bg-primary/10"
        }`}
      >
        {archiving ? t("meetings.archive") : t("meetings.reactivate")}
      </button>
      {state?.error && <p className="text-xs text-destructive">{state.error}</p>}
    </form>
  );
}
