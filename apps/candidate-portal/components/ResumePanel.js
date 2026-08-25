"use client";

import { useActionState } from "react";
import { useT } from "@hris/ui/client";
import { INPUT, LABEL } from "@/components/HistoryRows";
import { replaceResume, removeResume } from "@/app/portal/profile/actions";

/**
 * The CV on file: what it is, a link to read it back, and the two ways to change it (M7).
 *
 * Its own pair of forms rather than fields on the profile form — see the note there. Two separate
 * `useActionState`s so that a failed upload cannot clear a "removed" message and vice versa.
 *
 * ⚠️ TAKES THE FILENAME, NEVER THE STORAGE KEY. This is a client component, so every prop is
 * serialized into the RSC payload and is readable in the page source. The first version took the
 * whole `{ key, fileName }` object and duly published `resumes/<uuid>.pdf` — a path into the private
 * store — which the browser check caught and the tests could not, because they never render.
 *
 * Nothing here needs the key: the download link points at `/portal/resume`, which takes no id at all
 * and resolves the file from the session. Same rule the ATS follows by omitting `resumeKey` from its
 * candidate select.
 */
export function ResumePanel({ fileName }) {
  const t = useT();
  const [replaceState, replaceAction, replacing] = useActionState(replaceResume, undefined);
  const [removeState, removeAction, removing] = useActionState(removeResume, undefined);

  return (
    <div className="flex flex-col gap-4">
      {fileName ? (
        <p className="text-sm">
          <span className="text-muted-foreground">{t("profile.onFile")} </span>
          <a href="/portal/resume" className="font-medium text-primary hover:underline">
            {fileName}
          </a>
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">{t("profile.noResume")}</p>
      )}

      <form action={replaceAction} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className={LABEL}>
            {fileName ? t("profile.replaceResume") : t("profile.uploadResume")}
          </span>
          <input
            name="resume" type="file" accept=".pdf,.doc,.docx" required
            className={`${INPUT} file:mr-3 file:rounded file:border-0 file:bg-muted file:px-3 file:py-1 file:text-sm`}
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit" disabled={replacing}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {replacing ? t("profile.uploading") : t("profile.upload")}
          </button>
          <span className="text-xs text-muted-foreground">{t("profile.resumeHint")}</span>
        </div>
        <Feedback state={replaceState} t={t} />
      </form>

      {/* Removing a CV from the profile does NOT take it off applications already submitted — each
          pins the file it was sent with. Said out loud in the hint, because the opposite assumption
          is the reasonable one to make. */}
      {fileName && (
        <form action={removeAction}>
          <button
            type="submit" disabled={removing}
            className="text-xs text-destructive hover:underline disabled:opacity-60"
          >
            {removing ? t("profile.removing") : t("profile.removeResume")}
          </button>
          <Feedback state={removeState} t={t} />
        </form>
      )}
    </div>
  );
}

// Each form renders its OWN result. Sharing one state between the two would leave a stale "removed"
// message sitting underneath a failed upload — the two actions are independent and their feedback
// has to be too.
//
// A `warning` is a SUCCESS with a leftover file, so it is shown in place of the success line rather
// than beside it: the CV did change, and saying both "updated" and "we couldn't clean up" in two
// separate green-and-red lines reads as a contradiction.
function Feedback({ state, t }) {
  if (!state) return null;
  if (state.error) return <p className="text-sm text-destructive">{state.error}</p>;
  if (state.warning) return <p className="text-sm text-destructive">{state.warning}</p>;
  if (state.ok) return <p className="text-sm text-primary">{t("profile.resumeSaved")}</p>;
  return null;
}
