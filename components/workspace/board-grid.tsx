"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FolderKanban } from "lucide-react";
import { toast } from "sonner";
import { boardCode } from "@/lib/format";
import { reorderBoards } from "@/actions/boards";
import { FavoriteToggle } from "./favorite-toggle";

export type BoardTile = {
  id: string;
  title: string;
  backgroundKind: string;
  backgroundValue: string;
  archived: boolean;
  // When non-null, this row is a sub-board: its parent is a regular board
  // in the same workspace. Used to render a SUB-BOARD chip on the tile so
  // users can tell sub-boards apart from top-level boards in the grid.
  parentBoardId?: string | null;
};

function SortableBoardTile({
  board,
  index,
  favorited,
}: {
  board: BoardTile;
  index: number;
  favorited: boolean;
}) {
  const router = useRouter();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: board.id });

  // dnd-kit fires onClick on the underlying element after a drag completes.
  // Suppress navigation for ~250ms post-drag so dragging a tile to reorder
  // doesn't also open the board.
  const dragSuppressUntil = useRef(0);
  useEffect(() => {
    if (isDragging) dragSuppressUntil.current = Infinity;
    else if (dragSuppressUntil.current === Infinity)
      dragSuppressUntil.current = Date.now() + 250;
  }, [isDragging]);

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: transition ?? "transform 220ms cubic-bezier(0.16,1,0.3,1)",
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 30 : undefined,
  };

  return (
    <li ref={setNodeRef} style={style}>
      <div
        {...attributes}
        {...listeners}
        role="link"
        tabIndex={0}
        aria-label={`Open board ${board.title}`}
        data-board-id={board.id}
        onClick={(e) => {
          if (e.defaultPrevented) return;
          if (Date.now() < dragSuppressUntil.current) return;
          router.push(`/b/${board.id}`);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            router.push(`/b/${board.id}`);
          }
        }}
        className="group/board glass relative flex aspect-[4/3] flex-col justify-between overflow-hidden rounded-2xl p-5 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-[color:var(--hairline-hi)] hover:bg-[rgb(255_255_255/0.06)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40 cursor-grab active:cursor-grabbing select-none"
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="mono-meta-sm text-fg-faint">
            {String(index + 1).padStart(2, "0")}
          </span>
          <div className="flex items-center gap-1.5">
            {board.parentBoardId && (
              <span
                data-testid="board-tile-subboard"
                title="Sub-board"
                className="chip mono-meta-sm inline-flex items-center gap-1 text-violet-300"
              >
                <FolderKanban className="size-3" aria-hidden />
                SUB-BOARD
              </span>
            )}
            <FavoriteToggle
              boardId={board.id}
              initial={favorited}
              size="sm"
            />
            <span className="chip">#{boardCode(board.id)}</span>
          </div>
        </div>

        <h2 className="font-sans text-xl font-semibold tracking-tight text-fg leading-tight">
          <span className="relative inline-block">
            {board.title}
            <span
              aria-hidden
              className="absolute left-0 right-0 -bottom-1 h-px origin-left scale-x-0 bg-fg/70 transition-transform duration-300 ease-out group-hover/board:scale-x-100"
            />
          </span>
        </h2>

        <div className="flex items-end justify-end">
          <span className="mono-meta-sm text-fg-muted transition-transform duration-200 group-hover/board:translate-x-0.5">
            OPEN &rarr;
          </span>
        </div>
      </div>
    </li>
  );
}

export function BoardGrid({
  boards,
  favoritedIds = [],
  workspaceId,
}: {
  boards: BoardTile[];
  favoritedIds?: string[];
  workspaceId: string;
}) {
  const visible = useMemo(() => boards.filter((b) => !b.archived), [boards]);
  const favSet = useMemo(() => new Set(favoritedIds), [favoritedIds]);

  const [order, setOrder] = useState<string[]>(() => visible.map((b) => b.id));
  useEffect(() => {
    setOrder(visible.map((b) => b.id));
  }, [visible]);

  const [, startT] = useTransition();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  if (visible.length === 0) {
    return (
      <div className="rounded-2xl border border-hairline bg-[color:var(--surface)] px-6 py-12 text-center space-y-2">
        <p className="mono-meta-sm text-fg-faint">NO BOARDS</p>
        <p className="text-sm text-fg-muted max-w-sm mx-auto">
          Use the New board button at the top to create one.
        </p>
      </div>
    );
  }

  const byId = new Map(visible.map((b) => [b.id, b]));

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = order.indexOf(String(active.id));
    const newIdx = order.indexOf(String(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    const prev = order;
    const next = arrayMove(order, oldIdx, newIdx);
    setOrder(next);
    startT(async () => {
      try {
        await reorderBoards({ workspaceId, orderedIds: next });
      } catch (err) {
        setOrder(prev);
        toast.error(
          "Failed to reorder boards: " + (err as Error).message,
        );
      }
    });
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={order} strategy={rectSortingStrategy}>
        <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {order.map((id, i) => {
            const b = byId.get(id);
            if (!b) return null;
            return (
              <SortableBoardTile
                key={id}
                board={b}
                index={i}
                favorited={favSet.has(id)}
              />
            );
          })}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
