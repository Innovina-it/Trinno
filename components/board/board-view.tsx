"use client";
import { useCallback, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  DndContext,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { Layers3 } from "lucide-react";
import { useBoardStore } from "@/stores/board-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { errorBus } from "@/lib/errors/error-bus";
import type { BoardRow } from "@/lib/queries/board-snapshot";
import { positionBetween } from "@/lib/ordering";
import {
  moveCard as moveCardAction,
  bulkSetSprint as bulkSetSprintAction,
} from "@/actions/cards";
import { moveList as moveListAction } from "@/actions/lists";
import { undoBus } from "@/lib/undo-bus";
import { QuickAddFab } from "@/components/quick-add-card-dialog";
import { BulkActionBar } from "./bulk-action-bar";
import type { SprintLite } from "@/components/sprint/sprint-picker";
import { Button } from "@/components/ui/button";
import { ListColumn } from "./list-column";
import { AddListForm } from "./add-list-form";
import { BoardFilterBar } from "./board-filter-bar";
import { SwimlaneRow } from "./swimlane-row";
import { SprintDropStrip } from "./sprint-drop-strip";
import { useBoardRealtime } from "@/hooks/use-board-realtime";
import { useWorkspaceRealtime } from "@/hooks/use-workspace-realtime";
import { useBoardPresence, type Viewer } from "@/hooks/use-board-presence";
import { PresenceAvatars } from "./presence-avatars";
import { boardCode } from "@/lib/format";
import {
  parseFilters,
  applyFilters,
  partitionLanes,
  type LaneMode,
} from "@/lib/board-filters";

// Plan #16b-γ-Master-D D1 — localStorage key for the sprint drop strip
// toggle. Lives on the board view; Roadmap has its own UI for sprint
// assignment.
const SPRINT_STRIP_KEY = "board.sprintStrip";

function decodeId(
  sortableId: string,
): { type: "list" | "card"; id: string } | null {
  const idx = sortableId.indexOf(":");
  if (idx < 0) return null;
  const prefix = sortableId.slice(0, idx);
  const id = sortableId.slice(idx + 1);
  if (prefix === "list") return { type: "list", id };
  if (prefix === "card") return { type: "card", id };
  return null;
}

export function BoardView({
  board,
  currentUser,
  sprints = [],
  children,
}: {
  board: BoardRow;
  currentUser: Viewer;
  sprints?: SprintLite[];
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const lists = useBoardStore((s) => s.lists);
  const cards = useBoardStore((s) => s.cards);
  const cardLabels = useBoardStore((s) => s.cardLabels);
  const cardMembers = useBoardStore((s) => s.cardMembers);
  const labels = useBoardStore((s) => s.labels);
  const boardProfiles = useBoardStore((s) => s.boardProfiles);
  const moveListLocal = useBoardStore((s) => s.moveList);
  const moveCardLocal = useBoardStore((s) => s.moveCard);
  // Plan #16b-γ-Master-D D1 — optimistic patches for sprint assignment go
  // through the per-board store (drives card-tile.sprintId visibility) and
  // the workspace store (drives the human-readable chip name). The CDC
  // echo from `cards` will reconcile both when the server confirms.
  const updateCardLocal = useBoardStore((s) => s.updateCard);
  const patchWorkspaceCard = useWorkspaceStore((s) => s.patchCard);
  const [, start] = useTransition();

  // Plan #16b-γ-Master-D D1 — toggle for the sprint drop strip. Persisted
  // to localStorage so the user's preference survives navigation. Initial
  // read happens lazily so SSR doesn't crash.
  const [showSprintStrip, setShowSprintStrip] = useState(() => {
    try {
      return typeof window !== "undefined"
        ? window.localStorage.getItem(SPRINT_STRIP_KEY) === "1"
        : false;
    } catch {
      return false;
    }
  });
  const toggleSprintStrip = useCallback(() => {
    setShowSprintStrip((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SPRINT_STRIP_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  useBoardRealtime(board.id, board.workspaceId);
  useWorkspaceRealtime(board.workspaceId);
  const viewers = useBoardPresence(board.id, currentUser);

  const filters = useMemo(
    () => parseFilters(new URLSearchParams(sp.toString())),
    [sp],
  );
  const laneMode = ((sp.get("lanes") as LaneMode | null) ?? "none") as LaneMode;

  const visibleCards = useMemo(
    () =>
      applyFilters(
        cards,
        { cardLabels, cardMembers, currentUserId: currentUser.userId },
        filters,
      ),
    [cards, cardLabels, cardMembers, currentUser.userId, filters],
  );

  const lanesPartitioned = useMemo(
    () =>
      partitionLanes(visibleCards, laneMode, {
        cardMembers,
        cardLabels,
        profiles: boardProfiles,
        labels,
      }),
    [visibleCards, laneMode, cardMembers, cardLabels, boardProfiles, labels],
  );

  // Distance-based activation needs enough travel to disambiguate click-to-open
  // vs drag-to-move. Too small → Link clicks steal the gesture. 8px feels right.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const listSortableIds = useMemo(
    () => lists.map((l) => `list:${l.id}`),
    [lists],
  );

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;

    const activeKey = decodeId(String(active.id));
    if (!activeKey) return;

    if (activeKey.type === "list") {
      const overKey = decodeId(String(over.id));
      if (!overKey || overKey.type !== "list") return;

      const fromIdx = lists.findIndex((l) => l.id === activeKey.id);
      const toIdx = lists.findIndex((l) => l.id === overKey.id);
      if (fromIdx < 0 || toIdx < 0) return;

      const reordered = arrayMove(lists, fromIdx, toIdx);
      const before = toIdx > 0 ? reordered[toIdx - 1].position : null;
      const after =
        toIdx < reordered.length - 1 ? reordered[toIdx + 1].position : null;
      const newPos = positionBetween(before, after);

      moveListLocal(activeKey.id, newPos);
      const retryMoveList = async () => {
        await moveListAction({ id: activeKey.id, position: newPos });
      };
      start(async () => {
        try {
          await moveListAction({ id: activeKey.id, position: newPos });
        } catch (err) {
          const msg = "Failed to move list: " + (err as Error).message;
          toast.error(msg);
          errorBus.push({ message: msg, retry: retryMoveList });
          router.refresh();
        }
      });
      return;
    }

    if (activeKey.type === "card") {
      const overKey = decodeId(String(over.id));
      const overData = over.data.current as
        | { type?: string; listId?: string; sprintId?: string }
        | undefined;

      const sourceCard = cards.find((c) => c.id === activeKey.id);
      if (!sourceCard) return;

      // Plan #16b-γ-Master-D D1 — drop onto a sprint band → assign sprint.
      // Checked before the list/card move branches because sprint bands are
      // their own droppable type with no list semantics.
      if (overData?.type === "sprint-band" && overData.sprintId) {
        const newSprintId = overData.sprintId;
        if (sourceCard.sprintId === newSprintId) return; // no-op
        const origSprintId = sourceCard.sprintId;
        // Optimistic — patch both stores so card-tile chip + tile.sprintId
        // update without a roundtrip.
        updateCardLocal(activeKey.id, { sprintId: newSprintId });
        patchWorkspaceCard(activeKey.id, { sprintId: newSprintId });
        const retrySprintAssign = async () => {
          await bulkSetSprintAction({
            cardIds: [activeKey.id],
            sprintId: newSprintId,
          });
        };
        start(async () => {
          try {
            await bulkSetSprintAction({
              cardIds: [activeKey.id],
              sprintId: newSprintId,
            });
          } catch (err) {
            // Revert both stores on failure.
            updateCardLocal(activeKey.id, { sprintId: origSprintId });
            patchWorkspaceCard(activeKey.id, { sprintId: origSprintId });
            const msg = "Failed to assign sprint: " + (err as Error).message;
            toast.error(msg);
            errorBus.push({ message: msg, retry: retrySprintAssign });
          }
        });
        return;
      }

      let toListId: string | null = null;
      let prevPos: string | null = null;
      let nextPos: string | null = null;

      if (overKey?.type === "card") {
        const targetCard = cards.find((c) => c.id === overKey.id);
        if (!targetCard) return;
        toListId = targetCard.listId;
        const targetListCards = cards.filter(
          (c) => c.listId === toListId && c.id !== activeKey.id,
        );
        let dropIndex = targetListCards.findIndex((c) => c.id === overKey.id);
        if (dropIndex < 0) dropIndex = targetListCards.length;
        prevPos =
          dropIndex > 0 ? targetListCards[dropIndex - 1].position : null;
        nextPos =
          dropIndex < targetListCards.length
            ? targetListCards[dropIndex].position
            : null;
      } else if (overData?.type === "list-drop" || overData?.type === "list") {
        toListId = overData.listId ?? null;
        if (!toListId) return;
        const targetListCards = cards.filter(
          (c) => c.listId === toListId && c.id !== activeKey.id,
        );
        prevPos =
          targetListCards.length > 0
            ? targetListCards[targetListCards.length - 1].position
            : null;
        nextPos = null;
      } else {
        return;
      }

      if (!toListId) return;
      const newPos = positionBetween(prevPos, nextPos);
      const targetListId = toListId;
      // Snapshot original list+position so the undo banner can put the
      // card back if the user changes their mind within 8s.
      const originalListId = sourceCard.listId;
      const originalPosition = sourceCard.position;
      moveCardLocal(activeKey.id, targetListId, newPos);
      const retryMoveCard = async () => {
        await moveCardAction({
          id: activeKey.id,
          listId: targetListId,
          position: newPos,
        });
      };
      start(async () => {
        try {
          await moveCardAction({
            id: activeKey.id,
            listId: targetListId,
            position: newPos,
          });
          if (originalListId !== targetListId) {
            // Plan #16b-γ-D (#10) — only push undo on cross-list moves.
            // Same-list reorders are too noisy and the user almost never
            // wants to undo them.
            undoBus.push({
              message: "Moved card to another list",
              undo: async () => {
                moveCardLocal(activeKey.id, originalListId, originalPosition);
                try {
                  await moveCardAction({
                    id: activeKey.id,
                    listId: originalListId,
                    position: originalPosition,
                  });
                } catch (err) {
                  const m = "Failed to undo move: " + (err as Error).message;
                  toast.error(m);
                  errorBus.push({ message: m });
                  router.refresh();
                }
              },
            });
          }
        } catch (err) {
          const msg = "Failed to move card: " + (err as Error).message;
          toast.error(msg);
          errorBus.push({ message: msg, retry: retryMoveCard });
          router.refresh();
        }
      });
    }
  }

  // Strict monochrome: ignore user's chosen board color, render neutral dark.
  const bg = `radial-gradient(70rem 50rem at 10% 0%,  rgb(255 255 255 / 0.04), transparent 60%),
              radial-gradient(60rem 40rem at 90% 100%, rgb(255 255 255 / 0.03), transparent 60%),
              var(--bg-deep)`;

  return (
    <div
      className="min-h-[calc(100vh-3.5rem)] flex flex-col relative"
      style={{ background: bg }}
    >
      {/* Soft noise overlay layered over the colored mesh */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.04] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.6'/></svg>\")",
          backgroundSize: "200px 200px",
        }}
      />

      {/* Board masthead — glass strip with gradient title accent */}
      <div className="relative border-b border-hairline px-6 py-5 backdrop-blur-xl bg-[color:rgb(10_10_10/0.55)]">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-2.5 min-w-0">
            <div className="mono-meta-sm flex items-center gap-2 text-fg-faint">
              <span className="chip">BOARD</span>
              <span className="text-fg/60">#{boardCode(board.id)}</span>
              <span
                aria-hidden
                className="block h-1.5 w-6 rounded-full bg-fg/30"
              />
            </div>
            <h1 className="serif-display text-[clamp(2rem,5vw,3.5rem)] leading-[0.95]">
              <span className="gradient-text">{board.title}</span>
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <PresenceAvatars viewers={viewers} />
            <button
              type="button"
              onClick={toggleSprintStrip}
              data-testid="board-sprint-strip-toggle"
              aria-pressed={showSprintStrip}
              title={
                showSprintStrip
                  ? "Hide sprint drop strip"
                  : "Show sprint drop strip — drag a card onto a band to assign it"
              }
              className={`chip inline-flex items-center gap-1.5 hover:bg-[rgb(255_255_255/0.08)] ${
                showSprintStrip
                  ? "bg-fg/10 text-fg ring-1 ring-fg/40"
                  : ""
              }`}
            >
              <Layers3 className="size-3" />
              SPRINTS
            </button>
            <Button
              render={<Link href={`/b/${board.id}/settings`} />}
              nativeButton={false}
              variant="outline"
              size="sm"
            >
              Board settings
            </Button>
          </div>
        </div>
      </div>

      <BoardFilterBar currentUserId={currentUser.userId} />

      <div className="relative flex flex-1 items-start gap-4 p-4">
        <div className="flex-1 min-w-0">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragEnd={onDragEnd}
          >
            {/* Plan #16b-γ-Master-D D1 — droppable strip lives inside the
                DndContext so the bands' useDroppable() registrations are
                visible to onDragEnd. Hidden when the toggle is off. */}
            {showSprintStrip && <SprintDropStrip />}
            {laneMode === "none" ? (
              <div className="flex items-start gap-4 overflow-x-auto px-2 pb-4 [&>*]:animate-in [&>*]:fade-in [&>*]:slide-in-from-bottom-3 [&>*]:duration-400">
                <SortableContext
                  items={listSortableIds}
                  strategy={horizontalListSortingStrategy}
                >
                  {lists.map((list, idx) => (
                    <ListColumn
                      key={list.id}
                      list={list}
                      boardId={board.id}
                      workspaceId={board.workspaceId}
                      ordinal={idx + 1}
                      cardIdFilter={
                        filters.types.length ||
                        filters.labelIds.length ||
                        filters.due ||
                        filters.assignedToMe ||
                        filters.scheduled
                          ? new Set(visibleCards.map((c) => c.id))
                          : undefined
                      }
                    />
                  ))}
                </SortableContext>
                <AddListForm boardId={board.id} />
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {lanesPartitioned.map((lane) => {
                  const laneSet = new Set(lane.cardIds);
                  return (
                    <SwimlaneRow
                      key={`lane:${laneMode}:${lane.key || "_empty"}`}
                      lane={lane}
                    >
                      <div className="flex items-start gap-4 overflow-x-auto px-2 pb-4">
                        <SortableContext
                          items={listSortableIds}
                          strategy={horizontalListSortingStrategy}
                        >
                          {lists.map((list, idx) => (
                            <ListColumn
                              key={`${lane.key || "_empty"}:${list.id}`}
                              list={list}
                              boardId={board.id}
                              workspaceId={board.workspaceId}
                              ordinal={idx + 1}
                              cardIdFilter={laneSet}
                            />
                          ))}
                        </SortableContext>
                      </div>
                    </SwimlaneRow>
                  );
                })}
                <div className="px-2">
                  <AddListForm boardId={board.id} />
                </div>
              </div>
            )}
          </DndContext>
        </div>
        {children}
      </div>
      <QuickAddFab />
      <BulkActionBar sprints={sprints} />
    </div>
  );
}
