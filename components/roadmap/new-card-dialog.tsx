"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { createCard, updateCard } from "@/actions/cards";
import { useWorkspaceStore } from "@/stores/workspace-store";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function plus14ISO(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 14);
  return d.toISOString().slice(0, 10);
}

export function RoadmapNewCardDialog({
  defaultStart,
  defaultTarget,
}: {
  defaultStart?: string;
  defaultTarget?: string;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [boardId, setBoardId] = useState("");
  const [listId, setListId] = useState("");
  const [start, setStart] = useState(defaultStart ?? todayISO());
  const [target, setTarget] = useState(defaultTarget ?? plus14ISO());
  const [pending, startTransition] = useTransition();

  const boards = useWorkspaceStore((s) => s.boards);
  const lists = useWorkspaceStore((s) => s.lists);

  const visibleBoards = useMemo(
    () => boards.filter((b) => !b.archived),
    [boards],
  );
  const listsForBoard = useMemo(
    () => lists.filter((l) => l.boardId === boardId),
    [lists, boardId],
  );

  // Default board to first available; default list to first list of board.
  useEffect(() => {
    if (!open) return;
    if (!boardId && visibleBoards[0]) setBoardId(visibleBoards[0].id);
  }, [open, boardId, visibleBoards]);
  useEffect(() => {
    if (!boardId) return;
    if (listsForBoard.find((l) => l.id === listId)) return;
    setListId(listsForBoard[0]?.id ?? "");
  }, [boardId, listsForBoard, listId]);

  function reset() {
    setTitle("");
    setStart(defaultStart ?? todayISO());
    setTarget(defaultTarget ?? plus14ISO());
  }

  function handleSubmit() {
    const t = title.trim();
    if (!t) {
      toast.error("Title required");
      return;
    }
    if (!listId) {
      toast.error("Pick a list");
      return;
    }
    if (start > target) {
      toast.error("Start must be on or before target");
      return;
    }
    const startISO = new Date(`${start}T00:00:00.000Z`).toISOString();
    const targetISO = new Date(`${target}T00:00:00.000Z`).toISOString();
    startTransition(async () => {
      try {
        const created = await createCard({ listId, title: t });
        await updateCard({
          id: created.id,
          startDate: startISO,
          targetDate: targetISO,
        });
        toast.success(`Created "${t}"`);
        setOpen(false);
        reset();
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="roadmap-new-card-trigger"
        className="chip inline-flex items-center gap-1.5 hover:bg-[rgb(255_255_255/0.08)]"
      >
        <Plus className="size-3" />
        NEW CARD
      </button>
      <DialogContent data-testid="roadmap-new-card-dialog">
        <DialogHeader>
          <DialogTitle>New card</DialogTitle>
          <DialogDescription>
            Lands in the chosen list with start + target dates set.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block space-y-1 text-xs">
            <span className="mono-meta-sm text-fg-faint">TITLE</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              data-testid="roadmap-new-card-title"
              className="w-full rounded-md border border-hairline bg-transparent px-2 py-1.5 text-fg outline-none focus:border-fg/40"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-xs">
              <span className="mono-meta-sm text-fg-faint">BOARD</span>
              <select
                value={boardId}
                onChange={(e) => setBoardId(e.target.value)}
                data-testid="roadmap-new-card-board"
                className="w-full rounded-md border border-hairline bg-transparent px-2 py-1.5 text-fg outline-none focus:border-fg/40"
              >
                {visibleBoards.length === 0 && (
                  <option value="">No boards</option>
                )}
                {visibleBoards.map((b) => (
                  <option key={b.id} value={b.id} className="bg-[color:var(--surface-strong)]">
                    {b.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs">
              <span className="mono-meta-sm text-fg-faint">LIST</span>
              <select
                value={listId}
                onChange={(e) => setListId(e.target.value)}
                data-testid="roadmap-new-card-list"
                className="w-full rounded-md border border-hairline bg-transparent px-2 py-1.5 text-fg outline-none focus:border-fg/40"
              >
                {listsForBoard.length === 0 && (
                  <option value="">No lists</option>
                )}
                {listsForBoard.map((l) => (
                  <option key={l.id} value={l.id} className="bg-[color:var(--surface-strong)]">
                    {l.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-xs">
              <span className="mono-meta-sm text-fg-faint">START</span>
              <input
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                data-testid="roadmap-new-card-start"
                className="w-full rounded-md border border-hairline bg-transparent px-2 py-1.5 text-fg outline-none focus:border-fg/40"
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="mono-meta-sm text-fg-faint">TARGET</span>
              <input
                type="date"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                data-testid="roadmap-new-card-target"
                className="w-full rounded-md border border-hairline bg-transparent px-2 py-1.5 text-fg outline-none focus:border-fg/40"
              />
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={pending}
            data-testid="roadmap-new-card-submit"
          >
            {pending ? "Creating…" : "Create card"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
