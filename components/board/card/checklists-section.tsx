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
import { undoBus } from "@/lib/undo-bus";

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
        undoBus.push({
          message: "Checklist added",
          undo: async () => {
            removeChecklistStore(c.id);
            try {
              await deleteChecklist({ id: c.id });
            } catch (err) {
              addChecklist(c);
              toast.error("Undo failed: " + (err as Error).message);
            }
          },
        });
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <section className="space-y-3" data-testid="checklists-section">
      <div className="flex items-baseline justify-between border-b border-hairline pb-1">
        <h3 className="mono-meta text-fg-muted">Checklists</h3>
      </div>

      {checklists.map((cl) => {
        const items = itemsByChecklist.filter((i) => i.checklistId === cl.id);
        const done = items.filter((i) => i.completed).length;
        return (
          <div
            key={cl.id}
            className="space-y-2 border border-hairline bg-[color:var(--surface)]/40 p-3"
            data-checklist-id={cl.id}
          >
            <div className="flex items-center justify-between gap-2 border-b border-hairline pb-2">
              <h4 className="serif-display text-lg text-fg leading-none">{cl.title}</h4>
              <span className="mono-meta-sm text-fg-muted tabular-nums">
                {done} / {items.length}
              </span>
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const snapshotItems = items;
                    try {
                      await deleteChecklist({ id: cl.id });
                      removeChecklistStore(cl.id);
                      undoBus.push({
                        message: "Checklist deleted",
                        undo: async () => {
                          try {
                            const restoredChecklist = await createChecklist({
                              cardId,
                              title: cl.title,
                            });
                            addChecklist(restoredChecklist);
                            for (const item of snapshotItems) {
                              const restoredItem = await addChecklistItem({
                                checklistId: restoredChecklist.id,
                                text: item.text,
                              });
                              addItem(restoredItem);
                              if (item.completed) {
                                await toggleChecklistItem({
                                  id: restoredItem.id,
                                  completed: true,
                                });
                                updateItem(restoredItem.id, {
                                  completed: true,
                                });
                              }
                            }
                          } catch (err) {
                            toast.error(
                              "Undo failed: " + (err as Error).message,
                            );
                          }
                        },
                      });
                    } catch (err) {
                      toast.error((err as Error).message);
                    }
                  })
                }
              >
                <X className="size-3.5" />
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
                      const prevCompleted = it.completed;
                      updateItem(it.id, { completed: newCompleted });
                      start(async () => {
                        try {
                          await toggleChecklistItem({
                            id: it.id,
                            completed: newCompleted,
                          });
                          undoBus.push({
                            message: newCompleted
                              ? "Checklist item completed"
                              : "Checklist item reopened",
                            undo: async () => {
                              updateItem(it.id, { completed: prevCompleted });
                              try {
                                await toggleChecklistItem({
                                  id: it.id,
                                  completed: prevCompleted,
                                });
                              } catch (err) {
                                updateItem(it.id, { completed: newCompleted });
                                toast.error(
                                  "Undo failed: " + (err as Error).message,
                                );
                              }
                            },
                          });
                        } catch (err) {
                          updateItem(it.id, { completed: !newCompleted });
                          toast.error((err as Error).message);
                        }
                      });
                    }}
                    className="size-3.5"
                  />
                  <span
                    className={
                      it.completed
                        ? "text-[color:var(--status-done)] line-through decoration-current/60"
                        : "text-fg"
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
                        const snapshot = it;
                        try {
                          await removeChecklistItem({ id: it.id });
                          removeItem(it.id);
                          undoBus.push({
                            message: "Checklist item deleted",
                            undo: async () => {
                              try {
                                const restored = await addChecklistItem({
                                  checklistId: snapshot.checklistId,
                                  text: snapshot.text,
                                });
                                addItem(restored);
                                if (snapshot.completed) {
                                  await toggleChecklistItem({
                                    id: restored.id,
                                    completed: true,
                                  });
                                  updateItem(restored.id, {
                                    completed: true,
                                  });
                                }
                              } catch (err) {
                                toast.error(
                                  "Undo failed: " + (err as Error).message,
                                );
                              }
                            },
                          });
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
  const removeItem = useBoardStore((s) => s.removeChecklistItem);
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
        undoBus.push({
          message: "Checklist item added",
          undo: async () => {
            removeItem(item.id);
            try {
              await removeChecklistItem({ id: item.id });
            } catch (err) {
              onAdd(item);
              toast.error("Undo failed: " + (err as Error).message);
            }
          },
        });
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
