"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bug, Layers3, Square } from "lucide-react";
import { AssigneePicker } from "./assignee-picker";
import { createCard, updateCard } from "@/actions/cards";
import { promoteCardToSubboard } from "@/actions/boards";
import { toggleCardMember } from "@/actions/card-members";
import { useWorkspaceFlag } from "@/lib/feature-flags/use-workspace-flag";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { type StatusKind } from "@/lib/status";
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
import { DatePicker } from "@/components/ui/date-picker";

function isoToDate(iso: string): Date | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function dateToIso(d: Date | null): string {
  if (!d) return "";
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dy = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${dy}`;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function plus14ISO(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 14);
  return d.toISOString().slice(0, 10);
}

// Subtask is no longer a top-level creatable type — child cards live as
// rows under their parent (Subtasks section), not as a peer type chosen
// at creation. Existing rows with type='subtask' continue to render via
// the card-quick-view legacy fallback.
//
// "sub-board" is a UX-only value: picking it creates a regular task card
// AND promotes it to a sub-board. The DB column `cards.type` still gets
// 'task' — sub-boardness lives on `boards.parent_card_id`.
// Pick the list a new card should default into, given that board's lists
// in display (position) order. Prefer the mapped "todo" column. With no
// todo list, fall back to the first list that is NOT a "done" column — a
// board reordered to lead with a done list (e.g. "Closed") must never
// default new cards into a completed state. Only land on a done list when
// every list on the board is done.
function pickDefaultListId(
  ordered: { id: string; statusKind: StatusKind | null }[],
): string | null {
  const todo = ordered.find((l) => l.statusKind === "todo");
  if (todo) return todo.id;
  const nonDone = ordered.find((l) => l.statusKind !== "done");
  return (nonDone ?? ordered[0])?.id ?? null;
}

type CardType = "task" | "bug" | "sub-board";
type TypeOption = {
  value: CardType;
  label: string;
  // Optional — Story is icon-less so the chip stays compact.
  Icon?: typeof Square;
  // Tailwind classes — text color baseline + selected-state ring/bg.
  text: string;
  ringSelected: string;
  bgSelected: string;
};
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
    value: "sub-board", label: "Sub-board", Icon: Layers3,
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
  // parent card. The dialog still falls back to the first visible
  // board/list when these are absent.
  defaultBoard?: string;
  defaultList?: string;
  defaultParent?: string | null;
}) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<CardType>("task");
  // Sub-board is a UX-only type. Picking it creates a task and promotes
  // the new card to a sub-board. Hidden entirely when the workspace flag
  // is off, so the picker degrades to 3 options.
  const subboardsEnabled = useWorkspaceFlag("subboards_enabled", true);
  const [boardId, setBoardId] = useState(defaultBoard ?? "");
  const [listId, setListId] = useState(defaultList ?? "");
  // Optional parent card. Roadmap paints/chip drags can pre-resolve the
  // lane parent into `defaultParent`; the dialog surfaces it so the user
  // can verify or switch before creating a child card.
  const [parentId, setParentId] = useState<string>(defaultParent ?? "");
  const [start, setStart] = useState(defaultStart ?? todayISO());
  const [target, setTarget] = useState(defaultTarget ?? plus14ISO());
  // Task — assignee picker parity with kanban add-card-form: pre-assign
  // members up front so the roadmap card lands with full minimum metadata.
  const [assignees, setAssignees] = useState<Set<string>>(() => new Set());
  const [pending, startTransition] = useTransition();
  const router = useRouter();
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
  const cards = useWorkspaceStore((s) => s.cards);
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  // Profile list at workspace scope mirrors `boardProfiles` on the board
  // snapshot but covers every member who's reachable from any board in
  // the workspace. Sufficient for the roadmap create dialog — the user
  // can already pick any board/list, so any workspace member is a valid
  // assignee.
  const workspaceProfiles = useWorkspaceStore((s) => s.workspaceProfiles);
  const upsertCardMember = useWorkspaceStore((s) => s.upsertCardMember);
  const removeCardMember = useWorkspaceStore((s) => s.removeCardMember);
  // When this is on AND the card has no parent, the server's createCardImpl
  // inserts the creator into card_members at INSERT time. The picker
  // pre-selects the creator so the UI reflects what's about to be persisted.
  const autoAssignCreator = useWorkspaceStore((s) => s.autoAssignCreator);

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
  // Boards that have a list mapped to status_kind="todo". Used to pick a
  // sane default when the caller did not specify a board — gantt new-card
  // should always land in a todo column.
  const boardsWithTodo = useMemo(() => {
    const ids = new Set(
      lists.filter((l) => l.statusKind === "todo").map((l) => l.boardId),
    );
    return visibleBoards.filter((b) => ids.has(b.id));
  }, [lists, visibleBoards]);
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
  const defaultListId = useMemo(
    () => pickDefaultListId(listsForBoard),
    [listsForBoard],
  );

  // When the dialog opens, seed boardId/listId from the provided defaults
  // if they're available, otherwise fall back to the first visible board.
  // The defaults take precedence on every open so a subsequent paint on a
  // different lane re-resolves to that lane's board.
  //
  // Precedence: defaultParent.boardId > defaultBoard > first visible board.
  // The parent wins because the DB trigger `cards_validate_parent` requires
  // child.board_id === parent.board_id — submitting with a list on a
  // different board than the parent will be rejected server-side.
  useEffect(() => {
    if (!open) return;
    if (defaultParent) {
      const parent = cards.find((c) => c.id === defaultParent);
      if (parent?.boardId) {
        if (boardId !== parent.boardId) setBoardId(parent.boardId);
        return;
      }
    }
    if (defaultBoard) {
      if (boardId !== defaultBoard) setBoardId(defaultBoard);
      return;
    }
    if (!boardId) {
      const pick = boardsWithTodo[0] ?? visibleBoards[0];
      if (pick) setBoardId(pick.id);
    }
    // boardId is intentionally omitted from deps — we only re-seed on open
    // or when the defaults change, not on every internal boardId edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultBoard, defaultParent, cards, visibleBoards, boardsWithTodo]);
  useEffect(() => {
    if (!open) return;
    // Only honor defaultList when it's actually on the resolved boardId.
    // After defaultParent-precedence kicks in above, defaultList from a
    // roadmap paint may belong to a different (lane) board than the
    // parent's board — using it would violate cards_validate_parent.
    if (defaultList) {
      const defList = lists.find((l) => l.id === defaultList);
      if (defList && defList.boardId === boardId) {
        if (listId !== defaultList) setListId(defaultList);
        return;
      }
    }
    if (!boardId) return;
    if (listsForBoard.find((l) => l.id === listId)) return;
    // Prefer the board's todo list; with none, fall back to the first
    // non-done list (never a "done" column like Closed), and only to the
    // first list outright if every list is done. See pickDefaultListId.
    setListId(defaultListId ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultList, boardId, listsForBoard, defaultListId, lists]);
  // Dialog stays mounted across opens, so useState initializers run once
  // at first render — meaning the start/target defaults from a roadmap
  // drag-paint were captured only on initial mount. Re-seed dates on every
  // open (and whenever the defaults change while open), matching the
  // board/list seeding above. Without this, a paint of any rectangle
  // length still opened the dialog at today / today+14.
  useEffect(() => {
    if (!open) return;
    setStart(defaultStart ?? todayISO());
    setTarget(defaultTarget ?? plus14ISO());
  }, [open, defaultStart, defaultTarget]);
  // Re-seed parent on every open so a subsequent paint on a different
  // lane re-resolves cleanly. Empty string = standalone card.
  useEffect(() => {
    if (!open) return;
    setParentId(defaultParent ?? "");
  }, [open, defaultParent]);
  // When the user picks a different parent, snap BOARD + LIST to the
  // parent's board + its todo list. Keeps child card creation coherent.
  useEffect(() => {
    if (!open) return;
    if (!parentId) return;
    const parent = cards.find((c) => c.id === parentId);
    if (!parent) return;
    if (parent.boardId && parent.boardId !== boardId) {
      setBoardId(parent.boardId);
      const ordered = lists
        .filter((l) => l.boardId === parent.boardId)
        .slice()
        .sort((a, b) => (a.position < b.position ? -1 : 1));
      setListId(pickDefaultListId(ordered) ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, parentId]);

  // Pre-select the creator in the assignee picker when the workspace has
  // auto-assign on and the card is a standalone (no parent). This mirrors
  // what createCardImpl will persist server-side — keeping the picker label
  // honest instead of showing "Pick assignees" for a card that's about to
  // land with the creator already assigned. Subtasks fall through to the
  // server's parent-member inheritance, so we don't pre-select for them.
  useEffect(() => {
    if (!open) return;
    if (!autoAssignCreator) return;
    if (parentId) return;
    if (!currentUserId) return;
    setAssignees((prev) => (prev.has(currentUserId) ? prev : new Set([...prev, currentUserId])));
  }, [open, autoAssignCreator, parentId, currentUserId]);

  function reset() {
    setTitle("");
    setType("task");
    setStart(defaultStart ?? todayISO());
    setTarget(defaultTarget ?? plus14ISO());
    setAssignees(new Set());
    setParentId(defaultParent ?? "");
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
    const parentCardId = parentId || null;
    // Guard: child.board_id must match parent.board_id (DB trigger
    // cards_validate_parent). If the dialog state is mid-snap and the
    // selected list is on a different board than the parent, re-snap to
    // the parent's todo list and bail so the user sees the change before
    // confirming the create.
    if (parentCardId) {
      const parent = cards.find((c) => c.id === parentCardId);
      const selectedList = lists.find((l) => l.id === listId);
      if (
        parent?.boardId &&
        selectedList?.boardId &&
        parent.boardId !== selectedList.boardId
      ) {
        const parentLists = lists
          .filter((l) => l.boardId === parent.boardId)
          .slice()
          .sort((a, b) => (a.position < b.position ? -1 : 1));
        const snap = pickDefaultListId(parentLists) ?? "";
        if (!snap) {
          toast.error("Parent card's board has no list to receive the subtask");
          return;
        }
        setBoardId(parent.boardId);
        setListId(snap);
        toast.message("Snapped to the parent's board — click Create again to confirm");
        return;
      }
    }
    const startISO = new Date(`${start}T00:00:00.000Z`).toISOString();
    const targetISO = new Date(`${target}T00:00:00.000Z`).toISOString();
    startTransition(async () => {
      try {
        const created = await createCard({
          listId,
          title: t,
          startDate: startISO,
          targetDate: targetISO,
          // Owner set at INSERT so it skips the owner-change trigger; the
          // creator is by definition a valid claimant. When a parent is set
          // (subtask), omit ownerId so the server inherits the parent's owner.
          ...(parentCardId
            ? { parentCardId }
            : currentUserId
              ? { ownerId: currentUserId }
              : {}),
        });
        // `type` needs a post-create patch — createCardImpl doesn't accept
        // it. "sub-board" is UX-only so we never write it as `cards.type`;
        // a sub-board card lives as a regular task with a 1:1 child board.
        if (type !== "task" && type !== "sub-board") {
          await updateCard({ id: created.id, type });
        }
        // Pre-assign members. Fire each one sequentially so per-call
        // errors surface as toasts, but the card itself is already saved.
        // When the workspace auto-assigns the creator and this is a
        // standalone card, the server has already inserted that row at
        // create-time — calling toggleCardMember again would *remove* it
        // (toggle is symmetric). We skip the creator in that case, and if
        // the user explicitly deselected themselves we toggle once after
        // the loop to undo the server's insert.
        const creatorAutoInserted =
          autoAssignCreator && !parentCardId && !!currentUserId;
        for (const userId of assignees) {
          if (creatorAutoInserted && userId === currentUserId) {
            // server already added — just mirror locally
            upsertCardMember({ cardId: created.id, userId });
            continue;
          }
          try {
            await toggleCardMember({ cardId: created.id, userId });
            upsertCardMember({ cardId: created.id, userId });
          } catch (err) {
            toast.error(
              "Saved card, but assignee failed: " + (err as Error).message,
            );
          }
        }
        if (
          creatorAutoInserted &&
          currentUserId &&
          !assignees.has(currentUserId)
        ) {
          // Pre-seeded creator was unticked by the user. Undo the server-side
          // insert so the final state matches the picker.
          try {
            await toggleCardMember({ cardId: created.id, userId: currentUserId });
            removeCardMember(created.id, currentUserId);
          } catch (err) {
            toast.error(
              "Saved card, but unassign failed: " + (err as Error).message,
            );
          }
        }
        if (type === "sub-board") {
          try {
            await promoteCardToSubboard({ cardId: created.id });
          } catch (err) {
            toast.error(
              "Saved card, but sub-board create failed: " +
                (err as Error).message,
            );
          }
        }
        toast.success(
          type === "sub-board"
            ? `Created sub-board "${t}"`
            : `Created card "${t}"`,
        );
        onOpenChange(false);
        reset();
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  const noBoards = visibleBoards.length === 0;

  if (noBoards) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent data-testid="roadmap-new-card-dialog">
          <DialogHeader>
            <DialogTitle>Create a board first</DialogTitle>
            <DialogDescription>
              Cards live inside a board. This workspace has none yet — make one,
              then come back to add cards to it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              data-testid="roadmap-new-card-create-board"
              onClick={() => {
                onOpenChange(false);
                router.push(`/w/${workspaceId}/boards`);
              }}
            >
              Create a board
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
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
              className={
                subboardsEnabled
                  ? "grid grid-cols-3 gap-1.5"
                  : "grid grid-cols-2 gap-1.5"
              }
              role="radiogroup"
              aria-label="Card type"
              data-testid="roadmap-new-card-type"
            >
              {TYPE_OPTIONS.filter(
                (opt) => subboardsEnabled || opt.value !== "sub-board",
              ).map((opt) => {
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
                    {opt.Icon && <opt.Icon className="size-3.5" aria-hidden />}
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
            <div className="space-y-1.5 text-xs">
              <span className="mono-meta-sm text-fg-faint">START</span>
              <div data-testid="roadmap-new-card-start">
                <DatePicker
                  value={isoToDate(start)}
                  onChange={(d) => {
                    // Keep the span: moving start with a target set slides the
                    // target by the same delta so the duration is preserved.
                    const oldStart = isoToDate(start);
                    const tgt = isoToDate(target);
                    if (d && oldStart && tgt) {
                      const delta = d.getTime() - oldStart.getTime();
                      if (delta !== 0) {
                        setTarget(dateToIso(new Date(tgt.getTime() + delta)));
                      }
                    }
                    setStart(dateToIso(d));
                  }}
                  triggerLabel="Set start"
                  inputLabel="Start date"
                />
              </div>
            </div>
            <div className="space-y-1.5 text-xs">
              <span className="mono-meta-sm text-fg-faint">TARGET</span>
              <div data-testid="roadmap-new-card-target">
                <DatePicker
                  value={isoToDate(target)}
                  onChange={(d) => setTarget(dateToIso(d))}
                  triggerLabel="Set target"
                  inputLabel="Target date"
                  // Target can't precede start; start itself is unconstrained.
                  minDate={isoToDate(start)}
                />
              </div>
            </div>
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
