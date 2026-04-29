"use client";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBoardStore } from "@/stores/board-store";
import {
  createChecklist,
  deleteChecklist,
  addChecklistItem,
  toggleChecklistItem,
  removeChecklistItem,
} from "@/actions/checklists";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import type { ChecklistItemRow } from "@/lib/queries/board-snapshot";

export function ChecklistsSection({ cardId }: { cardId: string }) {
  const allChecklists = useBoardStore((s) => s.checklists);
  const checklists = useMemo(
    () => allChecklists.filter((c) => c.cardId === cardId),
    [allChecklists, cardId],
  );
  const itemsByChecklist = useBoardStore((s) => s.checklistItems);
  const addChecklist = useBoardStore((s) => s.addChecklist);
  const removeChecklistStore = useBoardStore((s) => s.removeChecklist);
  const addItem = useBoardStore((s) => s.addChecklistItem);
  const removeItem = useBoardStore((s) => s.removeChecklistItem);
  const updateItem = useBoardStore((s) => s.updateChecklistItem);

  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [pending, start] = useTransition();

  function add(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      try {
        const c = await createChecklist({ cardId, title: newTitle });
        addChecklist(c);
        setNewTitle("");
        setAdding(false);
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <section className="space-y-3" data-testid="checklists-section">
      <h3 className="text-sm font-semibold">Checklists</h3>

      {checklists.map((cl) => {
        const items = itemsByChecklist.filter((i) => i.checklistId === cl.id);
        const done = items.filter((i) => i.completed).length;
        return (
          <div
            key={cl.id}
            className="space-y-2 rounded border p-3"
            data-checklist-id={cl.id}
          >
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-medium">{cl.title}</h4>
              <span className="text-xs text-muted-foreground">
                {done} / {items.length}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    try {
                      await deleteChecklist({ id: cl.id });
                      removeChecklistStore(cl.id);
                    } catch (err) {
                      toast.error((err as Error).message);
                    }
                  })
                }
              >
                <X className="size-4" />
              </Button>
            </div>
            <ul className="space-y-1.5">
              {items.map((it) => (
                <li
                  key={it.id}
                  className="flex items-center gap-2 text-sm"
                  data-item-id={it.id}
                >
                  <input
                    type="checkbox"
                    checked={it.completed}
                    onChange={(e) => {
                      const newCompleted = e.target.checked;
                      updateItem(it.id, { completed: newCompleted });
                      start(async () => {
                        try {
                          await toggleChecklistItem({
                            id: it.id,
                            completed: newCompleted,
                          });
                        } catch (err) {
                          updateItem(it.id, { completed: !newCompleted });
                          toast.error((err as Error).message);
                        }
                      });
                    }}
                  />
                  <span
                    className={
                      it.completed
                        ? "text-muted-foreground line-through"
                        : ""
                    }
                  >
                    {it.text}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        try {
                          await removeChecklistItem({ id: it.id });
                          removeItem(it.id);
                        } catch (err) {
                          toast.error((err as Error).message);
                        }
                      })
                    }
                  >
                    <X className="size-3" />
                  </Button>
                </li>
              ))}
            </ul>
            <AddItem checklistId={cl.id} onAdd={addItem} />
          </div>
        );
      })}

      {adding ? (
        <form onSubmit={add} className="space-y-1">
          <Input
            autoFocus
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Checklist title"
            required
            minLength={1}
            maxLength={120}
          />
          <div className="flex gap-1">
            <Button
              type="submit"
              size="sm"
              disabled={pending || !newTitle.trim()}
            >
              Add
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setAdding(false)}
            >
              <X className="size-4" />
            </Button>
          </div>
        </form>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
          <Plus className="mr-1 size-4" /> Add checklist
        </Button>
      )}
    </section>
  );
}

function AddItem({
  checklistId,
  onAdd,
}: {
  checklistId: string;
  onAdd: (i: ChecklistItemRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      try {
        const item = await addChecklistItem({ checklistId, text });
        onAdd(item);
        setText("");
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  if (!open)
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <Plus className="mr-1 size-4" /> Add item
      </Button>
    );
  return (
    <form onSubmit={submit} className="flex gap-1">
      <Input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Item text"
        required
        minLength={1}
        maxLength={500}
        className="h-8"
      />
      <Button type="submit" size="sm" disabled={pending || !text.trim()}>
        Add
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(false)}
      >
        <X className="size-4" />
      </Button>
    </form>
  );
}
