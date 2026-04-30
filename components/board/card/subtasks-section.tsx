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
  const done = children.filter((c) => (c as { type?: string }).type === "subtask"
    && c.archived).length;
  // We don't have a 'completed' field for cards beyond archive — treat archived as done for subtasks.
  const total = children.length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  function create(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    start(async () => {
      try {
        const child = await createCard({ listId, title: text });
        addCardLocal(child);
        // Promote it to subtask + set parent
        const updated = await updateCard({ id: child.id, type: "subtask", parentCardId: cardId });
        updateCardLocal(child.id, { type: "subtask", parentCardId: cardId } as Partial<typeof child>);
        setText("");
        setAdding(false);
        void updated;
      } catch (err) { toast.error((err as Error).message); }
    });
  }

  function toggleArchive(child: { id: string; archived: boolean }) {
    start(async () => {
      try {
        await archiveCard({ id: child.id, archived: !child.archived });
        if (child.archived) updateCardLocal(child.id, { archived: false });
        else removeCardLocal(child.id);
      } catch (err) { toast.error((err as Error).message); }
    });
  }

  return (
    <div className="space-y-3" data-testid="subtasks-section">
      <div className="flex items-center justify-between">
        <h3 className="mono-meta text-fg">Sub-tasks</h3>
        {total > 0 && (
          <span className="mono-meta-sm text-fg-muted tabular-nums">{done}/{total} ({pct}%)</span>
        )}
      </div>
      {total > 0 && (
        <div className="h-1 w-full bg-[rgb(255_255_255/0.06)] rounded">
          <div
            className="h-full bg-fg/70 rounded transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      <ul className="space-y-1">
        {children.map((c) => (
          <li
            key={c.id}
            className="flex items-center gap-2 text-sm border border-hairline rounded-lg p-2"
          >
            <input
              type="checkbox"
              checked={c.archived}
              onChange={() => toggleArchive({ id: c.id, archived: c.archived })}
              className="accent-fg"
            />
            <TypeIcon type={(c as { type?: string }).type ?? "task"} />
            <Link
              href={`/b/${boardId}/c/${c.id}`}
              className={`flex-1 hover:underline ${c.archived ? "line-through text-fg-muted" : ""}`}
            >
              {c.title}
            </Link>
            <Button
              type="button" variant="ghost" size="xs"
              onClick={() => toggleArchive({ id: c.id, archived: c.archived })}
              disabled={pending}
            >
              <Trash2 className="size-3" />
            </Button>
          </li>
        ))}
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
