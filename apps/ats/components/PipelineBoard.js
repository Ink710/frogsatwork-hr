import Link from "next/link";
import {
  nextStage,
  nextRound,
  REJECTION_REASONS,
  ALLOWED_STAGE_TRANSITIONS,
  hasRemainingRounds,
} from "@hris/recruiting";
import { getLocale, getT } from "@/lib/i18n.server";
import { INTL_LOCALE, formatDate } from "@hris/ui";
import { BOARD_STAGES } from "@/lib/queries";
import { StageBadge } from "@/components/recruiting-ui";
import { StageMoveActions } from "@/components/StageMoveActions";
import { PipelineDndBoard } from "@/components/PipelineDndBoard";
import { ReopenApplication } from "@/components/ReopenApplication";

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
  // Backward moves (Polish B) get buttons too, one per legal earlier stage.
  //
  // ⚠️ This is not decoration. Without it the new capability would be DRAG-ONLY — unreachable by
  // keyboard, unusable with a screen reader, and awkward on touch. The whole argument for adding
  // drag rather than substituting it is that both surfaces offer the same moves; a capability that
  // exists only for mouse users breaks exactly that.
  for (const stage of backwardStages(card.stage)) {
    buttons.push({
      kind: "move",
      toStage: stage,
      label: t("action.moveBackTo", { stage: t(`enum.applicationStage.${stage}`) }),
      tone: "muted",
    });
  }

  // Reject is `kind: "reject"`, not a plain move: since M12 a rejection must carry a structured
  // reason, so the button expands into a small form instead of firing immediately.
  buttons.push({ kind: "reject", label: t("action.reject"), tone: "danger" });
  // Withdraw confirms before firing (M13) — it used to be one irreversible click.
  buttons.push({ kind: "withdraw", label: t("action.withdraw"), tone: "muted" });
  return buttons;
}

// The earlier active stages this card may return to — the backward half of the transition table,
// filtered to real board columns and ordered as they appear on the board.
function backwardStages(stage) {
  const idx = BOARD_STAGES.indexOf(stage);
  return (ALLOWED_STAGE_TRANSITIONS[stage] ?? []).filter(
    (s) => BOARD_STAGES.includes(s) && BOARD_STAGES.indexOf(s) < idx,
  );
}

// Which COLUMNS this card may legally be dropped on — computed from the same rules the server action
// enforces, so the drag affordance can never offer a move the server would then refuse.
//
// Two narrowings on top of ALLOWED_STAGE_TRANSITIONS:
//   • REJECTED / WITHDRAWN are dropped: they aren't columns on this board, they're the Closed list.
//     (Rejecting also requires a structured reason since M12, which a drag can't collect.)
//   • OFFER is dropped while interview rounds remain — the same guard moveApplication applies.
function dropTargets(card, rounds) {
  const allowed = ALLOWED_STAGE_TRANSITIONS[card.stage] ?? [];
  return allowed.filter((stage) => {
    if (!BOARD_STAGES.includes(stage)) return false;
    if (card.stage === "INTERVIEW" && stage === "OFFER") {
      return !hasRemainingRounds(rounds, card.currentRoundId);
    }
    return true;
  });
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
      {/* Columns + cards are rendered by the client drag layer, but everything IN them is prepared
          HERE: translated labels, the card body, the move buttons, and each card's legal drop
          targets. The client contributes interaction and no rules. */}
      <PipelineDndBoard
        jobId={jobId}
        canManage={canManage}
        labels={{
          emptyColumn: t("board.emptyColumn"),
          invalidMove: t("err.invalidTransition"),
        }}
        stages={BOARD_STAGES.map((stage) => ({
          stage,
          label: <StageBadge stage={stage} label={t(`enum.applicationStage.${stage}`)} />,
        }))}
        cards={BOARD_STAGES.flatMap((stage) =>
          columns[stage].map((card) => ({
            id: card.id,
            stage,
            dropTargets: dropTargets(card, rounds),
            // Why a drop was refused, translated up front so the client needn't reason about it.
            blockedReason:
              stage === "INTERVIEW" && hasRemainingRounds(rounds, card.currentRoundId)
                ? t("err.roundsRemaining")
                : t("err.invalidTransition"),
            body: (
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
            ),
            actions: canManage ? (
              // ⚠️ THE KEY IS REQUIRED EVEN THOUGH THIS IS A PROP, NOT A MAPPED CHILD. These
              // elements are built inside flatMap and handed to a client component inside an array
              // of card objects; React reconciles them positionally and warns without a stable one
              // ("Each child in a list should have a unique key ... passed a child from
              // PipelineBoard"). `Card` is keyed by card.id already, so per-card state was never at
              // risk — but the warning was real, and it printed ONCE per server start (React dedupes
              // key warnings per component), which is why it read as unreproducible for weeks.
              <StageMoveActions
                key={card.id}
                jobId={jobId}
                appId={card.id}
                buttons={cardButtons(card, rounds, t)}
                rejectionOptions={rejectionOptions(t)}
                labels={{
                  reasonLabel: t("reject.reasonLabel"),
                  confirm: t("reject.confirm"),
                  cancel: t("reject.cancel"),
                  withdrawConfirm: t("withdraw.confirm"),
                  withdrawConfirmHint: t("withdraw.confirmHint"),
                }}
              />
            ) : null,
          })),
        )}
      />

      {closed.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t("board.closed")}
          </h2>
          <ul className="flex flex-wrap gap-2">
            {closed.map((card) => (
              <li key={card.id} className="flex items-center gap-2 rounded-lg border border-border bg-card/40 px-3 py-2 text-sm">
                <Link href={`/jobs/${jobId}/applications/${card.id}`} className="hover:opacity-80">
                  <span className="font-medium">{card.candidateName}</span>{" "}
                  <StageBadge stage={card.stage} label={t(`enum.applicationStage.${card.stage}`)} />
                </Link>
                {/* Only WITHDRAWN can come back. A REJECTED card deliberately has no control here —
                    reconsidering someone means a new application, which is what keeps the rejection
                    reason M12 records tied to the decision it explains. */}
                {canManage && card.stage === "WITHDRAWN" && (
                  <ReopenApplication jobId={jobId} appId={card.id} label={t("action.reopen")} />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!canManage && <p className="mt-4 text-xs text-muted-foreground">{t("board.readOnly")}</p>}
    </div>
  );
}
