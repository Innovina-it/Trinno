"use client";
import { useRouter } from "next/navigation";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { CalendarRange, CornerDownRight } from "lucide-react";
import {
  PriorityChip,
  type CardPriority,
} from "@/components/board/card/priority-picker";
import { CompleteToggle } from "@/components/board/card/complete-toggle";

// No `useWorkspaceStore` import — board title and sprint name are passed
// in by the view (computed once via Map lookup, not per-card subscription).

function fmtShortDate(d: Date | string | null): string | null {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// `DRAG_THRESHOLD` is documented for clarity; the real enforcement lives
// on the dnd-kit PointerSensor `activationConstraint.distance` configured
// at the view level.
const DRAG_THRESHOLD = 4;
void DRAG_THRESHOLD;

export function AllTasksCard({
  cardId,
  boardId,
  boardTitle,
  title,
  listId,
  sprintId,
  sprintName,
  priority,
  dueDate,
  completedAt,
}: {
  cardId: string;
  boardId: string;
  boardTitle: string | null;
  title: string;
  listId: string;
  sprintId: string | null;
  sprintName: string | null;
  priority: CardPriority | null;
  dueDate: Date | string | null;
  completedAt?: Date | string | null;
}) {
  const completed = completedAt != null;
  const router = useRouter();
  void sprintId;
  const due = fmtShortDate(dueDate);
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `card:${cardId}`,
      data: { type: "card", cardId, boardId, listId },
    });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      data-testid="all-tasks-card"
      data-card-id={cardId}
      data-board-id={boardId}
      data-list-id={listId}
      role="button"
      tabIndex={0}
      onClick={(e) => {
        // dnd-kit's PointerSensor fires drag only past activationConstraint.
        // For a click (no drag), navigate to the card modal.
        if (e.defaultPrevented) return;
        router.push(`/b/${boardId}/c/${cardId}`);
      }}
      style={{
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.55 : 1,
        cursor: "grab",
      }}
      className="block rounded-md border border-hairline bg-[color:var(--surface)] hover:bg-[rgb(255_255_255/0.04)] transition-colors p-2.5 space-y-2 select-none"
    >
      <div className="flex items-start gap-2">
        <CompleteToggle cardId={cardId} completed={completed} size="sm" />
        <div
          className={`flex-1 min-w-0 text-sm leading-snug ${
            completed ? "line-through text-fg-muted" : "text-fg"
          }`}
        >
          {title}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 mono-meta-sm text-fg-muted">
        {boardTitle && (
          <span
            className="chip"
            data-testid="all-tasks-card-board-chip"
            title={`Board: ${boardTitle}`}
          >
            <CornerDownRight className="size-3" />
            {boardTitle.toUpperCase()}
          </span>
        )}
        {sprintName && (
          <span className="chip" title={`Sprint: ${sprintName}`}>
            {sprintName.toUpperCase()}
          </span>
        )}
        {due && (
          <span className="chip">
            <CalendarRange className="size-3" />
            {due}
          </span>
        )}
        {priority && <PriorityChip priority={priority} />}
      </div>
    </div>
  );
}
