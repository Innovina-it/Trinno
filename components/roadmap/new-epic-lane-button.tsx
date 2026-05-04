"use client";
import { useMemo, useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { createCard, updateCard } from "@/actions/cards";

/**
 * Plan #lane-as-kanban — one-click "+ New epic lane" affordance for the
 * roadmap header (visible only when laneMode === "epic"). Bypasses the
 * board → list → card → modal → flip-type-to-epic workflow:
 *
 *   1. Open dialog, enter epic title.
 *   2. Resolve the first non-archived board + its first list (by position).
 *   3. createCard({ listId, title }) → updateCard({ id, type: "epic" }).
 *   4. Realtime CDC echo upserts the card → roadmap renders the new lane.
 *
 * If no board exists, the button is shown disabled with a helpful tooltip
 * (workspaces with zero boards can't host an epic lane).
 */
export function NewEpicLaneButton() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [pending, startTransition] = useTransition();

  const boards = useWorkspaceStore((s) => s.boards);
  const lists = useWorkspaceStore((s) => s.lists);

  const firstBoard = useMemo(
    () => boards.find((b) => !b.archived),
    [boards],
  );
  const firstListOnBoard = useMemo(() => {
    if (!firstBoard) return undefined;
    // Pick the visually-first list on the board by fractional position so
    // the new epic card lands somewhere predictable (top-of-board).
    const onBoard = lists.filter((l) => l.boardId === firstBoard.id);
    onBoard.sort((a, b) => (a.position < b.position ? -1 : 1));
    return onBoard[0];
  }, [firstBoard, lists]);

  const canCreate = !!firstBoard && !!firstListOnBoard;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!canCreate || !trimmed) return;
    // Seed default dates so the epic lane is immediately visible on the
    // roadmap. The roadmap filters out cards lacking either start or
    // target date — without this, a freshly created epic looks invisible.
    // 2-week default span starting today (UTC midnight); user can edit
    // via the right-click menu's Edit dates.
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const target = new Date(today);
    target.setUTCDate(target.getUTCDate() + 14);
    const startISO = today.toISOString();
    const targetISO = target.toISOString();
    startTransition(async () => {
      try {
        const card = await createCard({
          listId: firstListOnBoard!.id,
          title: trimmed,
        });
        await updateCard({
          id: card.id,
          type: "epic",
          startDate: startISO,
          targetDate: targetISO,
        });
        toast.success(`Epic "${trimmed}" created`);
        setTitle("");
        setOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to create epic");
      }
    });
  };

  if (!canCreate) {
    return (
      <button
        type="button"
        disabled
        title="Create a board first to add an epic"
        data-testid="roadmap-new-epic-button"
        className="chip inline-flex items-center gap-1.5 opacity-50 cursor-not-allowed"
      >
        <Plus className="size-3" />
        NEW EPIC
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="roadmap-new-epic-button"
        title={`Create a new epic on board "${firstBoard!.title}"`}
        className="chip inline-flex items-center gap-1.5 hover:bg-[rgb(255_255_255/0.08)]"
      >
        <Plus className="size-3" />
        NEW EPIC
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="roadmap-new-epic-dialog">
          <DialogHeader>
            <DialogTitle>Create a new epic</DialogTitle>
            <DialogDescription>
              Adds an epic-typed card to your workspace. The roadmap renders
              one lane per epic.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="roadmap-new-epic-title">Title</Label>
              <Input
                id="roadmap-new-epic-title"
                autoFocus
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Build auth flow"
                disabled={pending}
                data-testid="roadmap-new-epic-title-input"
              />
            </div>
            <p className="mono-meta-sm text-fg-faint">
              Will be created on board{" "}
              <span className="text-fg-muted">{firstBoard!.title}</span>.
            </p>
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
                type="submit"
                disabled={pending || !title.trim()}
                data-testid="roadmap-new-epic-submit"
              >
                {pending ? "Creating…" : "Create epic"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
