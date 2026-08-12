"use client";

import { useOptimistic, useState, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { moveApplication } from "@/app/(internal)/jobs/actions";

// The drag layer. Everything it renders was prepared by PipelineBoard on the server — translated
// labels, the card body, the move buttons, and each card's LEGAL DROP TARGETS. This component
// contributes interaction and nothing else; it holds no pipeline rules of its own, which is what
// stops the drag affordance from drifting away from what the server will actually permit.
//
// ⚠️ The stage buttons are still here, inside every card. Drag is ADDITIVE. A board you can only
// operate by dragging is unusable with a keyboard, hostile on touch, and invisible to a screen
// reader — the buttons are the real interface and the dragging is a shortcut for people who like it.

function Column({ stage, label, count, isOver, isValidTarget, dragging, children }) {
  const { setNodeRef } = useDroppable({ id: stage });

  // Three visual states while a drag is in flight: the column you're over, a column you could drop
  // on, and one you can't. Outside a drag, none of them apply — a static board shouldn't look busy.
  const tone = !dragging
    ? "border-border"
    : isOver && isValidTarget
      ? "border-primary ring-2 ring-primary/30"
      : isValidTarget
        ? "border-primary/40"
        : "border-border opacity-40";

  return (
    <div ref={setNodeRef} className={`rounded-xl border bg-card/40 p-3 transition-colors ${tone}`}>
      <div className="mb-2 flex items-center justify-between">
        {label}
        <span className="font-mono text-xs text-muted-foreground">{count}</span>
      </div>
      {children}
    </div>
  );
}

function Card({ card, canManage, body, actions }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: card.id,
    disabled: !canManage,
  });

  return (
    <li
      ref={setNodeRef}
      className={`rounded-lg border border-border bg-card p-3 ${isDragging ? "opacity-40" : ""}`}
    >
      {/* The drag handle is a dedicated element, not the whole card: the card contains a link and
          buttons, and making all of it draggable would fight both. */}
      {canManage && (
        <div
          {...listeners}
          {...attributes}
          className="mb-1 cursor-grab select-none text-xs text-muted-foreground active:cursor-grabbing"
        >
          ⠿
        </div>
      )}
      {body}
      {actions}
    </li>
  );
}

export function PipelineDndBoard({ jobId, stages, cards, canManage, labels }) {
  const [error, setError] = useState(null);
  const [, startTransition] = useTransition();
  const [activeId, setActiveId] = useState(null);

  // Optimistic stage per card: the card lands in the new column immediately, and React discards the
  // optimistic value when the action settles — so a server refusal reverts it without extra code.
  const [optimistic, moveOptimistic] = useOptimistic(cards, (state, { id, stage }) =>
    state.map((c) => (c.id === id ? { ...c, stage } : c)),
  );

  const sensors = useSensors(
    // A small distance so a click on the handle isn't read as a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const active = optimistic.find((c) => c.id === activeId) ?? null;

  function onDragEnd({ active: dragged, over }) {
    setActiveId(null);
    if (!over) return;

    const card = cards.find((c) => c.id === dragged.id);
    const toStage = over.id;
    if (!card || toStage === card.stage) return;

    // Refused client-side using the SAME prepared list the columns dim from — so the explanation is
    // immediate and no pointless request is made. The server re-checks regardless; this is a
    // courtesy, not the guard.
    if (!card.dropTargets.includes(toStage)) {
      setError(card.blockedReason ?? labels.invalidMove);
      return;
    }

    setError(null);
    startTransition(async () => {
      moveOptimistic({ id: card.id, stage: toStage });
      const fd = new FormData();
      fd.set("toStage", toStage);
      const res = await moveApplication(jobId, card.id, undefined, fd);
      if (res?.error) setError(res.error);
    });
  }

  return (
    <DndContext
      // A STABLE id. Without it dnd-kit derives its aria-describedby ids from an incrementing
      // counter, which starts over on the client and hydrates mismatched against the server's.
      id="pipeline-board"
      sensors={sensors}
      onDragStart={({ active: a }) => {
        setActiveId(a.id);
        setError(null);
      }}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={onDragEnd}
    >
      {error && (
        <p role="status" className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {stages.map(({ stage, label }) => {
          const inColumn = optimistic.filter((c) => c.stage === stage);
          return (
            <Column
              key={stage}
              stage={stage}
              label={label}
              count={inColumn.length}
              dragging={Boolean(active)}
              isValidTarget={Boolean(active) && active.dropTargets.includes(stage)}
              isOver={false}
            >
              <ul className="flex flex-col gap-2">
                {inColumn.length === 0 && (
                  <li className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                    {labels.emptyColumn}
                  </li>
                )}
                {inColumn.map((card) => (
                  <Card
                    key={card.id}
                    card={card}
                    canManage={canManage}
                    body={card.body}
                    actions={card.actions}
                  />
                ))}
              </ul>
            </Column>
          );
        })}
      </div>

      {/* The card under the cursor. Rendered outside the columns so it isn't clipped by them. */}
      <DragOverlay>
        {active ? (
          <div className="rounded-lg border border-primary bg-card p-3 shadow-lg">{active.body}</div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
