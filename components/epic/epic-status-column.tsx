"use client";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CardTile } from "@/components/board/card-tile";
import type { CardRow } from "@/lib/queries/board-snapshot";
import type { StatusKind } from "@/lib/status";
import { STATUS_LABEL } from "@/lib/status";

export function EpicStatusColumn({
  statusKind,
  cards,
  boardId,
  workspaceId,
}: {
  statusKind: StatusKind | "unmapped";
  cards: CardRow[];
  boardId: string;
  workspaceId: string;
}) {
  const droppableId = `epic-col:${statusKind}`;
  const { setNodeRef, isOver } = useDroppable({
    id: droppableId,
    data: { type: "epicStatusColumn", statusKind },
  });
  const label =
    statusKind === "unmapped" ? "Unmapped" : STATUS_LABEL[statusKind].toUpperCase();

  return (
    <section
      ref={setNodeRef}
      data-testid={`epic-col-${statusKind}`}
      data-status-kind={statusKind}
      data-over={isOver ? "true" : undefined}
      className="flex flex-col w-72 shrink-0 rounded-2xl bg-[color:var(--surface)] border border-hairline data-[over=true]:border-[color:var(--status-in-progress)] data-[over=true]:shadow-[0_0_0_1px_var(--status-in-progress)]"
    >
      <header className="flex items-center justify-between px-3 py-2 border-b border-hairline">
        <h2
          className="mono-meta-sm tracking-wide"
          style={
            statusKind === "unmapped"
              ? { color: "var(--fg-faint)" }
              : { color: `var(--status-${statusKind.replace("_", "-")})` }
          }
        >
          {label}
        </h2>
        <span className="mono-meta-sm text-fg-faint">{cards.length}</span>
      </header>
      <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-24">
        <SortableContext
          items={cards.map((c) => `card:${c.id}`)}
          strategy={verticalListSortingStrategy}
        >
          {cards.map((c) => (
            <CardTile key={c.id} card={c} boardId={boardId} workspaceId={workspaceId} />
          ))}
        </SortableContext>
        {cards.length === 0 && (
          <div className="text-fg-faint text-xs py-4 text-center">
            Drop here
          </div>
        )}
      </div>
    </section>
  );
}
