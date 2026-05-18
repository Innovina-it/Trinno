"use client";
import { useContext, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "zustand";
import { Layers3, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { BoardStoreContext, type BoardStore } from "@/stores/board-store";
import { createCard } from "@/actions/cards";
import { getBoardsWithLists, promoteCardToSubboard } from "@/actions/boards";
import { errorBus } from "@/lib/errors/error-bus";
import { useWorkspaceFlag } from "@/lib/feature-flags/use-workspace-flag";

type BoardWithLists = Awaited<ReturnType<typeof getBoardsWithLists>>[number];

/**
 * Plan #16b-γ-D (#6) — Quick-add card dialog.
 *
 * Two modes: board (when BoardStoreContext is mounted) shows a single
 * list dropdown sourced from the store; cross-workspace global mode
 * fetches readable boards/lists via `getBoardsWithLists`.
 */
export function QuickAddCardDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const boardStore = useContext(BoardStoreContext);
  return boardStore ? (
    <BoardModeDialog
      open={open}
      onOpenChange={onOpenChange}
      boardStore={boardStore}
    />
  ) : (
    <GlobalModeDialog open={open} onOpenChange={onOpenChange} />
  );
}

function BoardModeDialog({
  open,
  onOpenChange,
  boardStore,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  boardStore: BoardStore;
}) {
  const router = useRouter();
  // The store already keeps lists sorted by position; selecting the
  // array reference directly avoids the "infinite loop" warning React
  // 19 throws when a selector returns a fresh array each render.
  const boardLists = useStore(boardStore, (s) => s.lists);
  const [listId, setListId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [asSubboard, setAsSubboard] = useState(false);
  const subboardsEnabled = useWorkspaceFlag("subboards_enabled", true);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (open && boardLists.length > 0 && !listId) {
      setListId(boardLists[0].id);
    }
  }, [open, boardLists, listId]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || !listId) return;
    start(async () => {
      try {
        const created = await createCard({ listId, title: trimmed });
        if (asSubboard) {
          try {
            await promoteCardToSubboard({ cardId: created.id });
          } catch (err) {
            toast.error(
              "Saved card, but sub-board create failed: " +
                (err as Error).message,
            );
          }
        }
        setTitle("");
        setAsSubboard(false);
        toast.success(asSubboard ? "Card + sub-board added" : "Card added");
        router.refresh();
      } catch (err) {
        const m = (err as Error).message;
        toast.error(m);
        errorBus.push({ message: `Quick-add failed: ${m}` });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Quick add.</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {boardLists.length === 0 ? (
            <p className="text-sm text-fg-muted italic">
              This board has no lists yet — add one first.
            </p>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="quick-add-list">List</Label>
                <Select
                  value={listId}
                  onValueChange={setListId}
                  data-testid="quick-add-list"
                  options={boardLists.map((l) => ({ value: l.id, label: l.title }))}
                  className="w-full"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="quick-add-title">Title</Label>
                <Input
                  id="quick-add-title"
                  autoFocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="What needs to be done?"
                  required
                  minLength={1}
                  maxLength={120}
                  data-testid="quick-add-title"
                />
              </div>
              {subboardsEnabled && (
                <label className="flex items-center gap-2 text-sm select-none">
                  <input
                    type="checkbox"
                    checked={asSubboard}
                    onChange={(e) => setAsSubboard(e.target.checked)}
                    data-testid="quick-add-subboard"
                    className="size-3.5 cursor-pointer accent-[color:var(--accent-cyan)]"
                  />
                  <Layers3 className="size-3.5 text-fg-muted" aria-hidden />
                  <span className="text-fg-muted">Create as sub-board</span>
                </label>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => onOpenChange(false)}
                  disabled={pending}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={pending || !title.trim() || !listId}
                  data-testid="quick-add-create"
                >
                  Create
                </Button>
              </div>
            </>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}

function GlobalModeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const [boards, setBoards] = useState<BoardWithLists[]>([]);
  const [loading, setLoading] = useState(false);
  const [boardId, setBoardId] = useState("");
  const [listId, setListId] = useState("");
  const [title, setTitle] = useState("");
  const [asSubboard, setAsSubboard] = useState(false);
  const subboardsEnabled = useWorkspaceFlag("subboards_enabled", true);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    getBoardsWithLists()
      .then((rows) => {
        if (cancelled) return;
        setBoards(rows);
        if (rows.length > 0 && !boardId) {
          setBoardId(rows[0].boardId);
          if (rows[0].lists.length > 0) setListId(rows[0].lists[0].id);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setBoards([]);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, boardId]);

  const selectedBoard = useMemo(
    () => boards.find((b) => b.boardId === boardId),
    [boards, boardId],
  );

  useEffect(() => {
    if (selectedBoard && selectedBoard.lists.length > 0) {
      if (!selectedBoard.lists.some((l) => l.id === listId)) {
        setListId(selectedBoard.lists[0].id);
      }
    }
  }, [selectedBoard, listId]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || !listId) return;
    start(async () => {
      try {
        const created = await createCard({ listId, title: trimmed });
        if (asSubboard) {
          try {
            await promoteCardToSubboard({ cardId: created.id });
          } catch (err) {
            toast.error(
              "Saved card, but sub-board create failed: " +
                (err as Error).message,
            );
          }
        }
        setTitle("");
        setAsSubboard(false);
        toast.success(asSubboard ? "Card + sub-board added" : "Card added");
        router.refresh();
      } catch (err) {
        const m = (err as Error).message;
        toast.error(m);
        errorBus.push({ message: `Quick-add failed: ${m}` });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Quick add.</DialogTitle>
        </DialogHeader>
        {loading ? (
          <p className="text-sm text-fg-muted italic py-3">Loading boards…</p>
        ) : boards.length === 0 ? (
          <p className="text-sm text-fg-muted italic py-3">
            No boards available. Create one first.
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="quick-add-board">Board</Label>
              <Select
                value={boardId}
                onValueChange={setBoardId}
                data-testid="quick-add-board"
                options={boards.map((b) => ({
                  value: b.boardId,
                  label: `${b.workspaceName} · ${b.boardTitle}`,
                }))}
                className="w-full"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quick-add-list-global">List</Label>
              <Select
                value={listId}
                onValueChange={setListId}
                data-testid="quick-add-list"
                disabled={!selectedBoard || selectedBoard.lists.length === 0}
                options={
                  !selectedBoard || selectedBoard.lists.length === 0
                    ? [{ value: "", label: "No lists in this board" }]
                    : selectedBoard.lists.map((l) => ({
                        value: l.id,
                        label: l.title,
                      }))
                }
                className="w-full"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quick-add-title-global">Title</Label>
              <Input
                id="quick-add-title-global"
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What needs to be done?"
                required
                minLength={1}
                maxLength={120}
                data-testid="quick-add-title"
              />
            </div>
            {subboardsEnabled && (
              <label className="flex items-center gap-2 text-sm select-none">
                <input
                  type="checkbox"
                  checked={asSubboard}
                  onChange={(e) => setAsSubboard(e.target.checked)}
                  data-testid="quick-add-subboard"
                  className="size-3.5 cursor-pointer accent-[color:var(--accent-cyan)]"
                />
                <Layers3 className="size-3.5 text-fg-muted" aria-hidden />
                <span className="text-fg-muted">Create as sub-board</span>
              </label>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={pending || !title.trim() || !listId}
                data-testid="quick-add-create"
              >
                Create
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Mounted globally in the app layout. Listens for `c` keydown and
 * decides whether to open. Skips when an input/textarea/contentEditable
 * is focused.
 */
export function QuickAddCardMount({
  hasWorkspaces,
}: {
  hasWorkspaces: boolean;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function isTyping(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      const tag = target.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    }
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target)) return;
      if (e.key === "c" || e.key === "C") {
        if (!hasWorkspaces) return;
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasWorkspaces]);

  if (!hasWorkspaces) return null;
  return <QuickAddCardDialog open={open} onOpenChange={setOpen} />;
}

/**
 * Floating + button for board pages. Mounted by BoardView so it only
 * appears in the board context (which conveniently means the dialog
 * uses the BoardStoreContext list source).
 */
export function QuickAddFab() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Quick add card"
        data-testid="quick-add-fab"
        className="shimmer-cta fixed bottom-6 right-6 z-40 inline-flex size-12 items-center justify-center rounded-full transition-transform duration-200 hover:scale-105 active:scale-95"
      >
        <Plus className="size-5" />
      </button>
      <QuickAddCardDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
