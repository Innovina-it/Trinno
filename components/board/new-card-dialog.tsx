"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Bug, Mountain, Square } from "lucide-react";
import { AssigneePicker } from "./assignee-picker";
import { createCard, updateCard } from "@/actions/cards";
import { toggleCardMember } from "@/actions/card-members";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function plus14ISO(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 14);
  return d.toISOString().slice(0, 10);
}

type CardType = "task" | "epic" | "story" | "bug";
type TypeOption = {
  value: CardType;
  label: string;
  Icon: typeof Square;
  // Tailwind classes — text color baseline + selected-state ring/bg.
  text: string;
  ringSelected: string;
  bgSelected: string;
};
// Story hidden from the picker (UX simplification). Legacy story-typed
// cards still render with their stored type; new cards default to Task.
const TYPE_OPTIONS: TypeOption[] = [
  {
    value: "task", label: "Task", Icon: Square,
    text: "text-fg-muted",
    ringSelected: "ring-fg/40",
    bgSelected: "bg-[rgb(255_255_255/0.10)]",
  },
  {
    value: "bug", label: "Bug", Icon: Bug,
    text: "text-rose-300",
    ringSelected: "ring-rose-400/60",
    bgSelected: "bg-rose-500/15",
  },
  {
    value: "epic", label: "Epic", Icon: Mountain,
    text: "text-violet-300",
    ringSelected: "ring-violet-400/60",
    bgSelected: "bg-violet-500/15",
  },
];

export function NewCardDialog({
  open,
  onOpenChange,
  defaultStart,
  defaultTarget,
  defaultBoard,
  defaultList,
  defaultParent,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  defaultStart?: string;
  defaultTarget?: string;
  // Plan #16b-γ-G G3 — drag-paint can pre-resolve a target board/list and
  // an epic parent (the lane the user painted on). The dialog still falls
  // back to the first visible board/list when these are absent.
  defaultBoard?: string;
  defaultList?: string;
  defaultParent?: string | null;
}) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<CardType>("task");
  const [boardId, setBoardId] = useState(defaultBoard ?? "");
  const [listId, setListId] = useState(defaultList ?? "");
  const [start, setStart] = useState(defaultStart ?? todayISO());
  const [target, setTarget] = useState(defaultTarget ?? plus14ISO());
  // Task — assignee picker parity with kanban add-card-form: pre-assign
  // members up front so the roadmap card lands with full minimum metadata.
  const [assignees, setAssignees] = useState<Set<string>>(() => new Set());
  const [pending, startTransition] = useTransition();
  // Task 10 — capture the signed-in user so freshly-created roadmap cards
  // own themselves out of the box (matches kanban inline create which
  // already auto-claims via the workspace `autoAssignCreator` flag).
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    createSupabaseBrowser()
      .auth.getUser()
      .then(({ data }) => {
        if (!cancelled) setCurrentUserId(data.user?.id ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const boards = useWorkspaceStore((s) => s.boards);
  const lists = useWorkspaceStore((s) => s.lists);
  // Profile list at workspace scope mirrors `boardProfiles` on the board
  // snapshot but covers every member who's reachable from any board in
  // the workspace. Sufficient for the roadmap create dialog — the user
  // can already pick any board/list, so any workspace member is a valid
  // assignee.
  const workspaceProfiles = useWorkspaceStore((s) => s.workspaceProfiles);
  const upsertCardMember = useWorkspaceStore((s) => s.upsertCardMember);

  function toggleAssignee(userId: string) {
    setAssignees((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  const visibleBoards = useMemo(
    () => boards.filter((b) => !b.archived),
    [boards],
  );
  // Task 10 — board's todo list is the preferred landing slot for any new
  // gantt card. Falling back on the first list (by position) when no
  // mapped todo column exists keeps creation unblocked on legacy boards.
  const listsForBoard = useMemo(
    () =>
      lists
        .filter((l) => l.boardId === boardId)
        .slice()
        .sort((a, b) => (a.position < b.position ? -1 : 1)),
    [lists, boardId],
  );
  const todoListId = useMemo(
    () => listsForBoard.find((l) => l.statusKind === "todo")?.id ?? null,
    [listsForBoard],
  );

  // When the dialog opens, seed boardId/listId from the provided defaults
  // if they're available, otherwise fall back to the first visible board.
  // The defaults take precedence on every open so a subsequent paint on a
  // different lane re-resolves to that lane's board.
  useEffect(() => {
    if (!open) return;
    if (defaultBoard) {
      if (boardId !== defaultBoard) setBoardId(defaultBoard);
      return;
    }
    if (!boardId && visibleBoards[0]) setBoardId(visibleBoards[0].id);
    // boardId is intentionally omitted from deps — we only re-seed on open
    // or when the defaults change, not on every internal boardId edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultBoard, visibleBoards]);
  useEffect(() => {
    if (!open) return;
    if (defaultList) {
      if (listId !== defaultList) setListId(defaultList);
      return;
    }
    if (!boardId) return;
    if (listsForBoard.find((l) => l.id === listId)) return;
    // Task 10 — prefer the board's todo list; only fall back to first
    // list (by position) if no list is mapped to status_kind=todo.
    setListId(todoListId ?? listsForBoard[0]?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultList, boardId, listsForBoard, todoListId]);

  function reset() {
    setTitle("");
    setType("task");
    setStart(defaultStart ?? todayISO());
    setTarget(defaultTarget ?? plus14ISO());
    setAssignees(new Set());
    // Note: we intentionally do NOT carry the prior defaultParent forward —
    // the parent is a per-open prop. RoadmapView clears its newCardDefaults
    // state on close so the next open re-derives it cleanly.
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
    const parentId = defaultParent ?? null;
    startTransition(async () => {
      try {
        const created = await createCard({ listId, title: t });
        await updateCard({
          id: created.id,
          startDate: startISO,
          targetDate: targetISO,
          // Only thread `type` when the user picked something other than
          // the default — keeps the patch minimal and avoids overwriting
          // a smarter default the action layer might apply later.
          ...(type !== "task" ? { type } : {}),
          // Only thread parentCardId through when the caller asked for it;
          // omit otherwise so the action treats it as "leave unchanged".
          ...(parentId ? { parentCardId: parentId } : {}),
          // Task 10 — claim ownership for the creator. Best-effort: when
          // `currentUserId` is unknown the field is omitted, and the
          // action layer's owner-claim guard handles the auth check (the
          // creator is the only viable claimant on an unowned card).
          ...(currentUserId ? { ownerId: currentUserId } : {}),
        });
        // Pre-assign members. Fire each one sequentially so per-call
        // errors surface as toasts, but the card itself is already saved.
        for (const userId of assignees) {
          try {
            await toggleCardMember({ cardId: created.id, userId });
            upsertCardMember({ cardId: created.id, userId });
          } catch (err) {
            toast.error(
              "Saved card, but assignee failed: " + (err as Error).message,
            );
          }
        }
        toast.success(`Created ${type === "epic" ? "epic" : "card"} "${t}"`);
        onOpenChange(false);
        reset();
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
          <div className="space-y-1 text-xs">
            <span className="mono-meta-sm text-fg-faint">TYPE</span>
            <div
              className="grid grid-cols-4 gap-1.5"
              role="radiogroup"
              aria-label="Card type"
              data-testid="roadmap-new-card-type"
            >
              {TYPE_OPTIONS.map((opt) => {
                const selected = type === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    data-testid={`roadmap-new-card-type-${opt.value}`}
                    data-selected={selected ? "true" : undefined}
                    onClick={() => setType(opt.value)}
                    className={[
                      "inline-flex items-center justify-center gap-1.5",
                      "rounded-full border border-hairline px-2.5 py-1.5",
                      "mono-meta-sm transition-all duration-150",
                      "hover:bg-[rgb(255_255_255/0.06)]",
                      opt.text,
                      selected
                        ? `${opt.bgSelected} ring-1 ${opt.ringSelected} border-transparent`
                        : "",
                    ].join(" ")}
                  >
                    <opt.Icon className="size-3.5" aria-hidden />
                    <span className={selected ? "text-fg" : ""}>{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-xs">
              <span className="mono-meta-sm text-fg-faint">BOARD</span>
              <Select
                value={boardId}
                onValueChange={setBoardId}
                data-testid="roadmap-new-card-board"
                options={
                  visibleBoards.length === 0
                    ? [{ value: "", label: "No boards" }]
                    : visibleBoards.map((b) => ({ value: b.id, label: b.title }))
                }
                className="w-full"
                size="sm"
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="mono-meta-sm text-fg-faint">LIST</span>
              <Select
                value={listId}
                onValueChange={setListId}
                data-testid="roadmap-new-card-list"
                options={
                  listsForBoard.length === 0
                    ? [{ value: "", label: "No lists" }]
                    : listsForBoard.map((l) => ({ value: l.id, label: l.title }))
                }
                className="w-full"
                size="sm"
              />
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
          {/* Assignee row — dropdown multi-select. Collapses to a single
              trigger button; users open it to check/uncheck members. */}
          {workspaceProfiles.length > 0 && (
            <div className="space-y-1 text-xs">
              <span className="mono-meta-sm text-fg-faint">ASSIGNEES</span>
              <AssigneePicker
                members={workspaceProfiles.map((p) => ({
                  id: p.id,
                  displayName: p.displayName,
                }))}
                selected={assignees}
                onToggle={toggleAssignee}
                testId="roadmap-new-card-assignees"
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
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
