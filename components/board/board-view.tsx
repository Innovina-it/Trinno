"use client";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { Layers3 } from "lucide-react";
import { useBoardStore } from "@/stores/board-store";
import { useIsGuest } from "@/lib/permissions/use-is-guest";
import { useWorkspaceStore } from "@/stores/workspace-store";
import {
  useBoards,
  useWorkspaceSnapshot,
} from "@/lib/queries/workspace-snapshot-shared";
import { useWorkspaceFlag } from "@/lib/feature-flags/use-workspace-flag";
import { logWorkspaceTabSwitchLatency } from "@/stores/workspace-cache-store";
import { errorBus } from "@/lib/errors/error-bus";
import type { BoardRow } from "@/lib/queries/board-snapshot";
import { positionBetween } from "@/lib/ordering";
import {
  moveCard as moveCardAction,
  bulkSetSprint as bulkSetSprintAction,
} from "@/actions/cards";
import { moveList as moveListAction } from "@/actions/lists";
import { undoBus } from "@/lib/undo-bus";
import { BulkActionBar } from "./bulk-action-bar";
import type { SprintLite } from "@/components/sprint/sprint-picker";
import { Button } from "@/components/ui/button";
import { ListColumn } from "./list-column";
import { AddListForm } from "./add-list-form";
import { BoardFilterBar } from "./board-filter-bar";
import { AssigneeFilterRow } from "@/components/filters/assignee-filter-row";
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
  isFilterActive,
  FILTER_QUERY_KEYS,
  hasExplicitFilterParams,
  preserveNonFilterParams,
  serializeFilters,
  type LaneMode,
} from "@/lib/board-filters";
import { useUserPreferences } from "@/lib/preferences/provider";
import {
  getBoardPreferences,
  patchBoardPreferences,
  patchWorkspacePreferences,
} from "@/lib/preferences/scoped";

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
}: {
  board: BoardRow;
  currentUser: Viewer;
  sprints?: SprintLite[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { preferences, setPreferences } = useUserPreferences();
  const boardPreferences = getBoardPreferences(preferences, board.id);
  const isGuest = useIsGuest();
  const allLists = useBoardStore((s) => s.lists);
  // milestone-as-card (U1) — hidden lists (e.g. the milestone host list)
  // never render as board columns or become drag targets.
  const lists = useMemo(() => allLists.filter((l) => !l.hidden), [allLists]);
  const cards = useBoardStore((s) => s.cards);
  const cardLabels = useBoardStore((s) => s.cardLabels);
  const cardMembers = useBoardStore((s) => s.cardMembers);
  const labels = useBoardStore((s) => s.labels);
  const boardProfiles = useBoardStore((s) => s.boardProfiles);
  const setWorkspaceSnapshot = useWorkspaceStore((s) => s.setSnapshot);
  const moveListLocal = useBoardStore((s) => s.moveList);
  const moveCardLocal = useBoardStore((s) => s.moveCard);
  // Plan #16b-γ-Master-D D1 — optimistic patches for sprint assignment go
  // through the per-board store (drives card-tile.sprintId visibility) and
  // the workspace store (drives the human-readable chip name). The CDC
  // echo from `cards` will reconcile both when the server confirms.
  const updateCardLocal = useBoardStore((s) => s.updateCard);
  const patchWorkspaceCard = useWorkspaceStore((s) => s.patchCard);
  const [, start] = useTransition();
  const sharedSnapshot = useWorkspaceSnapshot(board.workspaceId);
  const sharedBoards = useBoards(board.workspaceId);
  // Default ON: the shared workspace cache is the standard behaviour for
  // every workspace; write the flag `false` on a workspace to opt it out.
  const sharedWorkspaceCacheEnabled = useWorkspaceFlag(
    "shared_workspace_cache_v2",
    true,
  );
  const displayBoard =
    sharedWorkspaceCacheEnabled
      ? (sharedBoards.find((b) => b.id === board.id) ?? board)
      : board;

  useEffect(() => {
    if (!sharedWorkspaceCacheEnabled || !sharedSnapshot) return;
    setWorkspaceSnapshot(sharedSnapshot);
  }, [setWorkspaceSnapshot, sharedSnapshot, sharedWorkspaceCacheEnabled]);

  useEffect(() => {
    logWorkspaceTabSwitchLatency("board", board.workspaceId);
  }, [board.workspaceId]);

  useEffect(() => {
    setPreferences((current) =>
      patchWorkspacePreferences(current, board.workspaceId, {
        activeTab: "board",
      }),
    );
  }, [board.workspaceId, setPreferences]);

  const showSprintStrip = boardPreferences.sprintStripVisible === true;
  const toggleSprintStrip = useCallback(() => {
    setPreferences((current) =>
      patchBoardPreferences(current, board.id, {
        sprintStripVisible:
          !(getBoardPreferences(current, board.id).sprintStripVisible === true),
      }),
    );
  }, [board.id, setPreferences]);

  useBoardRealtime(board.id, board.workspaceId);
  useWorkspaceRealtime(board.workspaceId);
  const activePresenceCardId = pathname.match(/\/c\/([0-9a-f-]{36})/)?.[1] ?? null;
  const activePresenceCard = activePresenceCardId
    ? cards.find((c) => c.id === activePresenceCardId)
    : null;
  const viewers = useBoardPresence(board.id, {
    ...currentUser,
    location: activePresenceCard ? "card" : "board",
    cardId: activePresenceCard?.id ?? null,
    cardTitle: activePresenceCard?.title ?? null,
  });

  const filters = useMemo(
    () => parseFilters(new URLSearchParams(sp.toString())),
    [sp],
  );
  const savedFilters = boardPreferences.filters;

  useEffect(() => {
    if (!savedFilters) return;
    const params = new URLSearchParams(sp.toString());
    if (hasExplicitFilterParams(params)) return;
    const nextParams = preserveNonFilterParams(
      params,
      serializeFilters(savedFilters),
    );
    const qs = nextParams.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [pathname, router, savedFilters, sp]);
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

  // Track the actively dragged card so we can render it inside <DragOverlay>.
  // Without an overlay, the card stays inside its source list's
  // overflow-y-auto container and visually clips at column edges — making
  // it look like it can't leave the list. The overlay floats outside any
  // ancestor scroll/transform and follows the cursor freely.
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const activeCard = useMemo(
    () => (activeCardId ? cards.find((c) => c.id === activeCardId) ?? null : null),
    [activeCardId, cards],
  );

  function onDragStart(e: DragStartEvent) {
    const k = decodeId(String(e.active.id));
    if (k?.type === "card") setActiveCardId(k.id);
    else setActiveCardId(null);
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveCardId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;

    const activeKey = decodeId(String(active.id));
    if (!activeKey) return;

    if (activeKey.type === "list") {
      // dnd-kit picks the topmost intersecting droppable. Three live under
      // each list column: the outer `list:<id>` sortable, the inner
      // `list-drop:<id>` droppable (covers the cards-area), and the per-card
      // `card:<id>` sortables. When the drag ends over an empty cards-area
      // (common for a fresh list with zero cards) or over a card, the prior
      // `overKey.type === "list"` guard bailed silently. Resolve the target
      // list via `over.data.current.listId` instead — every droppable
      // attached inside a list-column carries it.
      const overData = over.data.current as
        | { type?: string; listId?: string }
        | undefined;
      const overListId = overData?.listId ?? null;
      if (!overListId || overListId === activeKey.id) return;

      const fromIdx = lists.findIndex((l) => l.id === activeKey.id);
      const toIdx = lists.findIndex((l) => l.id === overListId);
      if (fromIdx < 0 || toIdx < 0) return;

      const reordered = arrayMove(lists, fromIdx, toIdx);
      const before = toIdx > 0 ? reordered[toIdx - 1].position : null;
      const after =
        toIdx < reordered.length - 1 ? reordered[toIdx + 1].position : null;
      const newPos = positionBetween(before, after);
      const originalListPosition = lists[fromIdx].position;

      moveListLocal(activeKey.id, newPos);
      const retryMoveList = async () => {
        await moveListAction({ id: activeKey.id, position: newPos });
      };
      start(async () => {
        try {
          await moveListAction({ id: activeKey.id, position: newPos });
        } catch (err) {
          // Revert local optimistic move so the list snaps back when the
          // server rejects (e.g. guest dragging a list).
          moveListLocal(activeKey.id, originalListPosition);
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
        const targetListCards = cards.filter((c) => c.listId === toListId);
        if (sourceCard.listId === toListId) {
          const oldIndex = targetListCards.findIndex((c) => c.id === activeKey.id);
          const newIndex = targetListCards.findIndex((c) => c.id === overKey.id);
          if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;
          const reordered = arrayMove(targetListCards, oldIndex, newIndex);
          const movedIndex = reordered.findIndex((c) => c.id === activeKey.id);
          prevPos =
            movedIndex > 0 ? reordered[movedIndex - 1].position : null;
          nextPos =
            movedIndex < reordered.length - 1
              ? reordered[movedIndex + 1].position
              : null;
        } else {
          const targetWithoutActive = targetListCards.filter(
            (c) => c.id !== activeKey.id,
          );
          let dropIndex = targetWithoutActive.findIndex((c) => c.id === overKey.id);
          if (dropIndex < 0) dropIndex = targetWithoutActive.length;
          prevPos =
            dropIndex > 0 ? targetWithoutActive[dropIndex - 1].position : null;
          nextPos =
            dropIndex < targetWithoutActive.length
              ? targetWithoutActive[dropIndex].position
              : null;
        }
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
          // Revert the optimistic move locally so the card snaps back to
          // its original list/position immediately — without this, a
          // rejected move (e.g. guest moving an unassigned card) leaves
          // the card visually moved until the next refresh.
          moveCardLocal(activeKey.id, originalListId, originalPosition);
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
      className="min-h-[calc(100dvh-3.5rem)] flex flex-col relative"
      style={{ background: bg }}
    >
      {/* Board masthead — quiet, dense strip. Single row when wide. */}
      <div className="relative border-b border-hairline px-3 sm:px-4 md:px-6 py-3 bg-[color:var(--bg-1)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-3 min-w-0">
            <span className="mono-meta-sm text-fg-faint shrink-0">
              BOARD · #{boardCode(board.id)}
            </span>
            <h1 className="font-sans text-lg font-semibold tracking-tight text-fg truncate">
              {displayBoard.title}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <PresenceAvatars viewers={viewers} />
            <button
              type="button"
              onClick={toggleSprintStrip}
              data-testid="board-sprint-strip-toggle"
              aria-pressed={showSprintStrip}
              title={
                showSprintStrip
                  ? "Hide sprint drop strip"
                  : "Show sprint drop strip"
              }
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs hover:bg-[rgb(255_255_255/0.08)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40 ${
                showSprintStrip
                  ? "border-fg/40 bg-fg/10 text-fg"
                  : "border-hairline bg-[color:var(--surface)] text-fg-muted hover:text-fg"
              }`}
            >
              <Layers3 className="size-3.5" />
              <span>Sprints</span>
            </button>
            {!isGuest && (
              <Button
                render={<Link href={`/b/${board.id}/settings`} />}
                nativeButton={false}
                variant="ghost"
                size="sm"
              >
                Settings
              </Button>
            )}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <AssigneeFilterRow boardId={board.id} />
          <BoardFilterBar
            boardId={board.id}
            currentUserId={currentUser.userId}
          />
        </div>
      </div>

      <div className="relative flex flex-1 items-start gap-4 p-2 sm:p-3 md:p-4">
        <div className="flex-1 min-w-0">
          <DndContext
            id={`dnd-board-${board.id}`}
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragCancel={() => setActiveCardId(null)}
          >
            {/* Plan #16b-γ-Master-D D1 — droppable strip lives inside the
                DndContext so the bands' useDroppable() registrations are
                visible to onDragEnd. Hidden when the toggle is off. */}
            {showSprintStrip && <SprintDropStrip />}
            {(() => {
              const filterActive = isFilterActive(filters);
              const hiddenByFilters =
                filterActive && cards.length > 0 && visibleCards.length === 0;
              if (!hiddenByFilters) return null;
              return (
                <div
                  className="mx-2 mb-3 rounded-xl border border-hairline-hi bg-[color:var(--surface-strong)] px-3 py-2 flex items-center justify-between gap-3"
                  data-testid="board-filtered-zero"
                >
                  <span className="mono-meta-sm text-fg">
                    {cards.length} {cards.length === 1 ? "CARD" : "CARDS"} HIDDEN BY FILTERS
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const params = new URLSearchParams(sp.toString());
                      for (const k of FILTER_QUERY_KEYS) {
                        params.delete(k);
                      }
                      const qs = params.toString();
                      router.replace(qs ? `${pathname}?${qs}` : pathname);
                      setPreferences((current) =>
                        patchBoardPreferences(current, board.id, {
                          filters: {
                            types: [],
                            labelIds: [],
                            due: null,
                            assignedToMe: false,
                            unassigned: false,
                            scheduled: false,
                            hideCompleted: false,
                            showDates: false,
                          },
                          dataVisibilityFilters: { assignee: "all" },
                        }),
                      );
                    }}
                    className="mono-meta-sm text-fg-muted hover:text-fg"
                  >
                    CLEAR FILTERS
                  </button>
                </div>
              );
            })()}
            {lists.length === 0 ? (
              <div
                className="mt-6 mx-2 rounded-2xl border border-hairline bg-[color:var(--surface)] px-6 py-16 text-center"
                data-testid="board-empty"
              >
                <p className="mono-meta-sm text-fg-faint">EMPTY BOARD</p>
                <p className="text-sm text-fg-muted max-w-sm mx-auto mt-2">
                  Add a list to start organizing cards.
                </p>
                <div className="mt-6 flex justify-center">
                  {!isGuest && <AddListForm boardId={board.id} />}
                </div>
              </div>
            ) : laneMode === "none" ? (
              <div className="flex items-start gap-4 overflow-x-auto px-2 pb-4 max-sm:snap-x max-sm:snap-mandatory [&>*]:animate-in [&>*]:fade-in [&>*]:slide-in-from-bottom-3 [&>*]:duration-400">
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
                        isFilterActive(filters)
                          ? new Set(visibleCards.map((c) => c.id))
                          : undefined
                      }
                    />
                  ))}
                </SortableContext>
                {!isGuest && <AddListForm boardId={board.id} />}
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
                      <div className="flex items-start gap-4 overflow-x-auto px-2 pb-4 max-sm:snap-x max-sm:snap-mandatory">
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
                  {!isGuest && <AddListForm boardId={board.id} />}
                </div>
              </div>
            )}
            {/* DragOverlay floats the active card outside any ancestor
                scroll/transform container so it follows the cursor freely
                across the viewport (instead of clipping at the source
                list's overflow boundary). Visual-only — drop logic stays
                on the original sortable card. */}
            <DragOverlay dropAnimation={null}>
              {activeCard ? (
                <div className="rounded-xl bg-[color:var(--surface-strong)] backdrop-blur-md border border-[color:var(--hairline-hi)] text-fg shadow-[0_0_0_1px_rgb(255_255_255/0.10),0_24px_50px_-12px_rgb(0_0_0/0.7)] px-3 py-2 w-72 rotate-[2deg] cursor-grabbing">
                  <span className="block text-sm leading-snug">
                    {activeCard.title}
                  </span>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>
      </div>
      <BulkActionBar sprints={sprints} />
    </div>
  );
}
