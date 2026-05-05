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
  const isUnmapped = statusKind === "unmapped";
  const { setNodeRef, isOver } = useDroppable({
    id: droppableId,
    data: { type: "epicStatusColumn", statusKind },
    disabled: isUnmapped,
  });
  const label = isUnmapped
    ? "Unmapped"
    : STATUS_LABEL[statusKind].toUpperCase();

  return (
    <section
      ref={setNodeRef}
      data-testid={`epic-col-${statusKind}`}
      data-status-kind={statusKind}
      data-over={isOver ? "true" : undefined}
      title={
        isUnmapped
          ? "Cards in lists without a status. Drag into a status column to triage."
          : undefined
      }
      className="flex flex-col w-80 shrink-0 rounded-2xl bg-[color:var(--surface)] border border-hairline data-[over=true]:bg-[color:var(--surface-strong)] data-[over=true]:ring-1 data-[over=true]:ring-fg/40 data-[over=true]:ring-inset transition-colors"
    >
      <header className="flex items-center justify-between px-3 py-2 border-b border-hairline">
        <h2
          className="mono-meta-sm tracking-wide flex items-center gap-1.5"
          style={
            isUnmapped
              ? { color: "var(--fg-faint)" }
              : { color: `var(--status-${statusKind.replace("_", "-")})` }
          }
        >
          <span
            aria-hidden
            className="size-2 rounded-full"
            style={{
              backgroundColor: isUnmapped
                ? "var(--fg-faint)"
                : `var(--status-${statusKind.replace("_", "-")})`,
            }}
          />
          {label}
        </h2>
        <span className="mono-meta-sm text-fg-faint tabular-nums">
          {cards.length}
        </span>
      </header>
      <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-24">
        <SortableContext
          items={cards.map((c) => `card:${c.id}`)}
          strategy={verticalListSortingStrategy}
        >
          {cards.map((c) => (
            <CardTile
              key={c.id}
              card={c}
              boardId={boardId}
              workspaceId={workspaceId}
            />
          ))}
        </SortableContext>
        {cards.length === 0 && !isUnmapped && (
          <div className="mono-meta-sm text-fg-faint py-4 text-center select-none">
            DROP HERE
          </div>
        )}
        {cards.length === 0 && isUnmapped && (
          <div className="mono-meta-sm text-fg-faint py-4 text-center select-none">
            EMPTY
          </div>
        )}
      </div>
    </section>
  );
}
