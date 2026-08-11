import Link from "next/link";
import { nextStage, nextRound, REJECTION_REASONS } from "@hris/recruiting";
import { getLocale, getT } from "@/lib/i18n.server";
import { INTL_LOCALE, formatDate } from "@hris/ui";
import { BOARD_STAGES } from "@/lib/queries";
import { StageBadge } from "@/components/recruiting-ui";
import { StageMoveActions } from "@/components/StageMoveActions";

// Compute a card's move buttons SERVER-SIDE, so the pipeline rules (@hris/recruiting) and i18n never
// reach the client as logic — only as prepared, translated descriptors. Terminal HIRED cards get none.
function cardButtons(card, rounds, t) {
  if (card.stage === "HIRED") return [];
  const buttons = [];
  if (card.stage === "INTERVIEW") {
    const next = nextRound(rounds, card.currentRoundId);
    if (next) buttons.push({ kind: "round", label: t("action.nextRound"), tone: "primary" });
    else buttons.push({ kind: "move", toStage: "OFFER", label: t("action.advanceToOffer"), tone: "primary" });
  } else {
    const ns = nextStage(card.stage);
    if (ns) {
      buttons.push({
        kind: "move",
        toStage: ns,
        label: t("action.advanceTo", { stage: t(`enum.applicationStage.${ns}`) }),
        tone: "primary",
      });
    }
  }
  // Reject is `kind: "reject"`, not a plain move: since M12 a rejection must carry a structured
  // reason, so the button expands into a small form instead of firing immediately.
  buttons.push({ kind: "reject", label: t("action.reject"), tone: "danger" });
  buttons.push({ kind: "move", toStage: "WITHDRAWN", label: t("action.withdraw"), tone: "muted" });
  return buttons;
}

// Reason options prepared server-side and already translated, so the client component stays a dumb
// renderer and @hris/recruiting never ships to the browser (the same discipline as cardButtons).
function rejectionOptions(t) {
  return REJECTION_REASONS.map((value) => ({ value, label: t(`enum.rejectionReason.${value}`) }));
}

// The pipeline board (server component): a column per active stage, cards grouped into them, plus a
// Closed list for REJECTED/WITHDRAWN. Move controls render only when the viewer can manage the job.
export async function PipelineBoard({ jobId, board }) {
  const t = await getT();
  const locale = INTL_LOCALE[await getLocale()];
  const { columns, rounds, closed, canManage } = board;

  return (
    <div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {BOARD_STAGES.map((stage) => (
          <div key={stage} className="rounded-xl border border-border bg-card/40 p-3">
            <div className="mb-2 flex items-center justify-between">
              <StageBadge stage={stage} label={t(`enum.applicationStage.${stage}`)} />
              <span className="font-mono text-xs text-muted-foreground">{columns[stage].length}</span>
            </div>
            <ul className="flex flex-col gap-2">
              {columns[stage].length === 0 && (
                <li className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                  {t("board.emptyColumn")}
                </li>
              )}
              {columns[stage].map((card) => (
                <li key={card.id} className="rounded-lg border border-border bg-card p-3">
                  <Link href={`/jobs/${jobId}/applications/${card.id}`} className="block hover:opacity-80">
                    <p className="font-medium">{card.candidateName}</p>
                    {stage === "INTERVIEW" && card.currentRound && (
                      <p className="mt-0.5 text-xs text-primary">
                        {t("board.round")}: {card.currentRound}
                      </p>
                    )}
                    {card.source && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{t("board.source", { source: card.source })}</p>
                    )}
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {t("board.appliedOn", { date: formatDate(card.appliedAt, locale) })}
                    </p>
                  </Link>
                  {canManage && <StageMoveActions
                      jobId={jobId}
                      appId={card.id}
                      buttons={cardButtons(card, rounds, t)}
                      rejectionOptions={rejectionOptions(t)}
                      labels={{
                        reasonLabel: t("reject.reasonLabel"),
                        confirm: t("reject.confirm"),
                        cancel: t("reject.cancel"),
                      }}
                    />}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {closed.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t("board.closed")}
          </h2>
          <ul className="flex flex-wrap gap-2">
            {closed.map((card) => (
              <li key={card.id} className="rounded-lg border border-border bg-card/40 px-3 py-2 text-sm">
                <Link href={`/jobs/${jobId}/applications/${card.id}`} className="hover:opacity-80">
                  <span className="font-medium">{card.candidateName}</span>{" "}
                  <StageBadge stage={card.stage} label={t(`enum.applicationStage.${card.stage}`)} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!canManage && <p className="mt-4 text-xs text-muted-foreground">{t("board.readOnly")}</p>}
    </div>
  );
}
