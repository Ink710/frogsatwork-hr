"use client";

import { useT } from "@hris/ui/client";
import { formatSlotWhen } from "@hris/recruiting";
import { useViewerZone } from "@/components/useViewerZone";

/**
 * One scheduled interview, shown to the candidate (M9).
 *
 * ⚠️ TWO RENDERINGS, AND THE ORDER MATTERS.
 *
 * The CANONICAL line is server-rendered and always names its zone — "Tue, 3 Mar 2026, 15:00–16:00
 * (America/Mexico_City)". That is the one that survives everywhere: it is what the email says, it is
 * in the HTML before any JavaScript runs, and it is unambiguous to a reader anywhere on earth.
 *
 * The LOCAL line is added afterwards, in the browser, because only the browser knows what zone this
 * person is actually in — nothing in the database does. It is a courtesy on top, never a
 * replacement: if scripting is off or hydration fails, the candidate still has a complete, correct
 * time rather than a bare number.
 */
export function InterviewTime({ interview, locale }) {
  const t = useT();
  const zone = useViewerZone();

  // Nothing to add when the viewer is already in the slot's own zone — repeating the same time
  // under a different label reads as a mistake.
  const local =
    zone && zone !== interview.timeZone ? formatSlotWhen({ ...interview, timeZone: zone }, locale) : null;

  return (
    <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
      <p className="font-medium">{t("portal.interviewTitle", { round: interview.roundName })}</p>
      <p className="mt-1">{formatSlotWhen(interview, locale)}</p>
      {local && <p className="mt-0.5 text-xs text-muted-foreground">{t("portal.interviewLocal", { when: local })}</p>}
      {interview.meetingUrl && (
        <a
          href={interview.meetingUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block text-primary hover:underline"
        >
          {t("portal.interviewJoin")}
        </a>
      )}
    </div>
  );
}
