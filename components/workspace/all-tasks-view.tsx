"use client";
import { useMemo } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useWorkspaceRealtime } from "@/hooks/use-workspace-realtime";
import {
  AGGREGATE_COLUMNS,
  groupByStatus,
  findTargetListId,
  cardMatchesFilter,
  type AggregateColumnId,
  type AggregateScope,
} from "@/lib/aggregate-kanban/group";
import { AllTasksColumn } from "./all-tasks-column";
import { AllTasksCard } from "./all-tasks-card";
import type { CardPriority } from "@/components/board/card/priority-picker";
import { moveCard } from "@/actions/cards";
import { errorBus } from "@/lib/errors/error-bus";
import { positionBetween } from "@/lib/ordering";

const SCOPES: AggregateScope[] = ["mine", "all"];

export function AllTasksView({
  workspaceId,
  viewerId,
}: {
  workspaceId: string;
  viewerId: string;
}) {
  // Live workspace store sync.
  useWorkspaceRealtime(workspaceId);

  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const scope: AggregateScope = SCOPES.includes(
    (sp.get("scope") ?? "mine") as AggregateScope,
  )
    ? ((sp.get("scope") ?? "mine") as AggregateScope)
    : "mine";
  const queryDraft = sp.get("q") ?? "";
  const sprintFilter = sp.get("sprint") ?? "";

  const setScope = (next: AggregateScope) => {
    const params = new URLSearchParams(sp.toString());
    if (next === "mine") params.delete("scope");
    else params.set("scope", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const setQuery = (next: string) => {
    const params = new URLSearchParams(sp.toString());
    if (next) params.set("q", next);
    else params.delete("q");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const cards = useWorkspaceStore((s) => s.cards);
  const lists = useWorkspaceStore((s) => s.lists);
  const cardMembers = useWorkspaceStore((s) => s.cardMembers);
  const sprints = useWorkspaceStore((s) => s.sprints);
  const boards = useWorkspaceStore((s) => s.boards);

  // Pre-compute board title + sprint name lookup once at the view level so
  // each rendered card avoids a per-row store selector. Cheap compared to
  // ~hundreds of card chips repeatedly walking `boards`/`sprints` arrays.
  const boardTitleById = useMemo(
    () => new Map(boards.map((b) => [b.id, b.title])),
    [boards],
  );
  const sprintNameById = useMemo(
    () => new Map(sprints.map((s) => [s.id, s.name])),
    [sprints],
  );

  // Sort lists by `position` ascending — `findTargetListId` relies on
  // ordered input to pick the visually-first matching list per board.
  const sortedLists = useMemo(
    () => [...lists].sort((a, b) => (a.position < b.position ? -1 : 1)),
    [lists],
  );

  const filtered = useMemo(
    () =>
      cards.filter((c) =>
        cardMatchesFilter(
          {
            id: c.id,
            title: c.title,
            priority: c.priority as CardPriority | null,
            sprintId: c.sprintId,
            dueDate: c.dueDate,
          },
          {
            scope,
            viewerId,
            members: cardMembers,
            query: queryDraft,
            sprintId: sprintFilter || undefined,
          },
        ),
      ),
    [cards, cardMembers, scope, viewerId, queryDraft, sprintFilter],
  );
  const grouped = useMemo(
    () => groupByStatus(filtered, sortedLists),
    [filtered, sortedLists],
  );

  // Reference boards so future empty-state branch can read it without
  // re-subscribing — keeps the selector in scope.
  void boards;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const patchCard = useWorkspaceStore((s) => s.patchCard);

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over) return;
    const activeData = active.data.current as
      | { type?: string; cardId?: string; boardId?: string; listId?: string }
      | undefined;
    const overData = over.data.current as
      | { type?: string; columnId?: AggregateColumnId }
      | undefined;
    if (
      !activeData ||
      activeData.type !== "card" ||
      !activeData.cardId ||
      !activeData.boardId
    ) {
      return;
    }
    if (!overData || overData.type !== "aggregate-column" || !overData.columnId) {
      return;
    }
    const card = cards.find((c) => c.id === activeData.cardId);
    if (!card) return;

    // No-op if dropped on the same column the card already lives in.
    const currentList = sortedLists.find((l) => l.id === card.listId);
    const currentCol = currentList?.statusKind ?? "unmapped";
    if (currentCol === overData.columnId) return;

    // Cross-board drag is out of scope for v1: the user dropped onto a
    // status column but cards live on one board. Find the FIRST list with
    // the target status_kind on the card's CURRENT board (already
    // position-sorted by the view-level memo).
    const toListId = findTargetListId(
      sortedLists,
      activeData.boardId,
      overData.columnId,
    );
    if (!toListId) {
      toast.error(
        overData.columnId === "unmapped"
          ? "Drop a card on a status column."
          : `No list with status "${overData.columnId.replace("_", " ")}" on this card's board.`,
      );
      return;
    }

    // Compute the destination position: append to the END of the target list
    // (mirrors how Kanban handles a cross-list drop with no target card).
    const targetListCards = cards
      .filter((c) => c.listId === toListId && !c.archived && c.id !== card.id)
      .sort((a, b) => (a.position < b.position ? -1 : 1));
    const lastPos =
      targetListCards.length > 0
        ? targetListCards[targetListCards.length - 1].position
        : null;
    const newPos = positionBetween(lastPos, null);

    // Optimistic: workspace store reflects the new listId immediately.
    // The board store on the source board will reconcile via realtime CDC.
    const origListId = card.listId;
    patchCard(card.id, { listId: toListId });
    void (async () => {
      try {
        await moveCard({ id: card.id, listId: toListId, position: newPos });
      } catch (err) {
        patchCard(card.id, { listId: origListId });
        const msg = "Failed to move card: " + (err as Error).message;
        toast.error(msg);
        errorBus.push({ message: msg });
      }
    })();
  }

  return (
    <div className="space-y-4" data-testid="all-tasks-view">
      <div className="flex items-center gap-2 flex-wrap">
        {SCOPES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setScope(s)}
            data-testid="all-tasks-scope-toggle"
            data-scope={s}
            data-active={scope === s ? "true" : "false"}
            className={`chip mono-meta-sm ${scope === s ? "ring-1 ring-fg/40 bg-fg/10" : ""}`}
          >
            {s === "mine" ? "MINE" : "ALL WORKSPACE"}
          </button>
        ))}
        <input
          type="search"
          value={queryDraft}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          data-testid="all-tasks-search"
          className="chip mono-meta-sm bg-transparent border border-hairline focus:border-fg/40 outline-none"
        />
        {sprints.length > 0 && (
          <select
            value={sprintFilter}
            onChange={(e) => {
              const params = new URLSearchParams(sp.toString());
              if (e.target.value) params.set("sprint", e.target.value);
              else params.delete("sprint");
              router.replace(`${pathname}?${params.toString()}`, {
                scroll: false,
              });
            }}
            data-testid="all-tasks-sprint-filter"
            className="chip mono-meta-sm bg-transparent border border-hairline"
          >
            <option value="">ANY SPRINT</option>
            {sprints
              .filter((s) => s.state !== "completed")
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        )}
      </div>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          {AGGREGATE_COLUMNS.map((col) => (
            <AllTasksColumn
              key={col.id}
              id={col.id}
              label={col.label}
              count={grouped[col.id].length}
            >
              {grouped[col.id].map((c) => (
                <AllTasksCard
                  key={c.id}
                  cardId={c.id}
                  boardId={c.boardId}
                  boardTitle={boardTitleById.get(c.boardId) ?? null}
                  title={c.title}
                  listId={c.listId}
                  sprintId={c.sprintId}
                  sprintName={c.sprintId ? sprintNameById.get(c.sprintId) ?? null : null}
                  priority={c.priority as CardPriority | null}
                  dueDate={c.dueDate}
                />
              ))}
            </AllTasksColumn>
          ))}
        </div>
      </DndContext>
    </div>
  );
}
