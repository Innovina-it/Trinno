"use client";
import { useState, useTransition, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBoardStore } from "@/stores/board-store";
import { createCard, updateCard, archiveCard } from "@/actions/cards";
import { TypeIcon } from "./type-picker";
import { Plus, X, Trash2 } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { CompleteToggle } from "./complete-toggle";
import { undoBus } from "@/lib/undo-bus";

export function SubtasksSection({
  cardId, listId, boardId,
}: { cardId: string; listId: string; boardId: string }) {
  const cards = useBoardStore((s) => s.cards);
  const addCardLocal = useBoardStore((s) => s.addCard);
  const updateCardLocal = useBoardStore((s) => s.updateCard);
  const removeCardLocal = useBoardStore((s) => s.removeCard);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();

  const children = useMemo(
    () => cards.filter((c) => (c as { parentCardId?: string | null }).parentCardId === cardId && !c.archived),
    [cards, cardId],
  );
  // Completion now uses cards.completed_at (migration 0062). The DB
  // trigger keeps it in sync with cards.due_complete so legacy callers
  // continue to work.
  const completedCount = children.filter(
    (c) => (c as { completedAt?: Date | string | null }).completedAt != null,
  ).length;
  const total = children.length;
  const pct = total === 0 ? 0 : Math.round((completedCount / total) * 100);

  function create(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    start(async () => {
      try {
        // Pass parentCardId on creation so the server-side owner inheritance
        // (actions/cards.ts createCardImpl) fires — without it the new row
        // is born owned by the creator, and the subsequent promotion update
        // does not retroactively re-resolve the owner.
        const child = await createCard({ listId, title: text, parentCardId: cardId });
        addCardLocal(child);
        // Promote to type=subtask; parent already set above.
        const updated = await updateCard({ id: child.id, type: "subtask" });
        updateCardLocal(child.id, { type: "subtask", parentCardId: cardId } as Partial<typeof child>);
        setText("");
        setAdding(false);
        undoBus.push({
          message: "Sub-task added",
          undo: async () => {
            removeCardLocal(child.id);
            try {
              await archiveCard({ id: child.id, archived: true });
            } catch (err) {
              addCardLocal({
                ...child,
                type: "subtask",
                parentCardId: cardId,
              });
              toast.error("Undo failed: " + (err as Error).message);
            }
          },
        });
        void updated;
      } catch (err) { toast.error((err as Error).message); }
    });
  }

  function toggleArchive(child: (typeof cards)[number]) {
    const nextArchived = !child.archived;
    if (nextArchived) removeCardLocal(child.id);
    else updateCardLocal(child.id, { archived: false });
    start(async () => {
      try {
        await archiveCard({ id: child.id, archived: nextArchived });
        undoBus.push({
          message: nextArchived ? "Sub-task archived" : "Sub-task restored",
          undo: async () => {
            if (nextArchived) {
              addCardLocal({ ...child, archived: false });
            } else {
              removeCardLocal(child.id);
            }
            try {
              await archiveCard({ id: child.id, archived: child.archived });
            } catch (err) {
              if (nextArchived) {
                removeCardLocal(child.id);
              } else {
                updateCardLocal(child.id, { archived: false });
              }
              toast.error("Undo failed: " + (err as Error).message);
            }
          },
        });
      } catch (err) {
        if (nextArchived) addCardLocal(child);
        else updateCardLocal(child.id, { archived: child.archived });
        toast.error((err as Error).message);
      }
    });
  }


  return (
    <div className="space-y-3" data-testid="subtasks-section">
      <div className="flex items-center justify-between">
        <h3 className="mono-meta text-fg">Sub-tasks</h3>
        {total > 0 && (
          <span className="mono-meta-sm text-fg-muted tabular-nums">
            {pct === 100 ? "ALL DONE" : `${completedCount} OF ${total} DONE`}
          </span>
        )}
      </div>
      {total > 0 && (
        <div
          className="h-1 w-full bg-[color:var(--surface-strong)] rounded overflow-hidden"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={`h-full rounded transition-[width,background-color] duration-300 ${
              pct === 100 ? "bg-[color:var(--accent-lime)]" : "bg-fg/70"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      <ul className="space-y-1">
        {children.map((c) => {
          const completedAt = (c as { completedAt?: Date | string | null }).completedAt ?? null;
          const isDone = completedAt != null;
          return (
            <li
              key={c.id}
              className="flex items-center gap-2 text-sm border border-hairline rounded-lg p-2"
            >
              <CompleteToggle
                cardId={c.id}
                completed={isDone}
                size="sm"
                onLocalChange={(next) =>
                  updateCardLocal(c.id, {
                    completedAt: next ? new Date() : null,
                    dueComplete: next,
                  } as Partial<typeof c>)
                }
              />
              <TypeIcon type={(c as { type?: string }).type ?? "task"} />
              <Link
                href={`/b/${boardId}/c/${c.id}`}
                className={`flex-1 hover:underline ${isDone ? "line-through text-fg-muted" : ""}`}
              >
                {c.title}
              </Link>
              <Button
                type="button" variant="ghost" size="xs"
                onClick={() => toggleArchive(c)}
                disabled={pending}
                title="Archive (remove from list)"
              >
                <Trash2 className="size-3" />
              </Button>
            </li>
          );
        })}
      </ul>
      {!adding ? (
        <Button
          type="button" variant="outline" size="sm"
          onClick={() => setAdding(true)}
        >
          <Plus className="size-3.5 mr-1" /> Add sub-task
        </Button>
      ) : (
        <form onSubmit={create} className="flex gap-2">
          <Input
            autoFocus value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What needs doing?"
            maxLength={120}
          />
          <Button type="submit" size="sm" disabled={pending || !text.trim()}>Add</Button>
          <Button
            type="button" variant="ghost" size="sm"
            onClick={() => { setAdding(false); setText(""); }}
          >
            <X className="size-3.5" />
          </Button>
        </form>
      )}
    </div>
  );
}
