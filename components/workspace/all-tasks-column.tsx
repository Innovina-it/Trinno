"use client";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { AggregateColumnId } from "@/lib/aggregate-kanban/group";

export function AllTasksColumn({
  id,
  label,
  count,
  children,
}: {
  id: AggregateColumnId;
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `aggregate-column:${id}`,
    data: { type: "aggregate-column", columnId: id },
  });
  return (
    <div
      ref={setNodeRef}
      data-testid="all-tasks-column"
      data-column-id={id}
      data-is-over={isOver ? "true" : undefined}
      className={`flex flex-col rounded-lg border border-hairline bg-[color:var(--surface-strong)] min-h-[60vh] ${
        isOver ? "ring-2 ring-fg/50" : ""
      }`}
    >
      <div className="px-3 py-2 border-b border-hairline flex items-center justify-between">
        <span className="mono-meta text-fg-muted">{label}</span>
        <span className="mono-meta-sm text-fg-faint" data-testid="all-tasks-column-count">
          {count}
        </span>
      </div>
      <div className="flex-1 p-2 space-y-2 overflow-y-auto">
        <SortableContext
          items={[]}
          strategy={verticalListSortingStrategy}
        >
          {children}
        </SortableContext>
      </div>
    </div>
  );
}
