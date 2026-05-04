"use client";
import Link from "next/link";
import { CalendarRange, CornerDownRight } from "lucide-react";
import {
  PriorityChip,
  type CardPriority,
} from "@/components/board/card/priority-picker";

function fmtShortDate(d: Date | string | null): string | null {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// Pure display — board title + sprint name come from the parent (precomputed
// from the workspace store at view level so this component doesn't subscribe
// to the store per render).
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
}) {
  const due = fmtShortDate(dueDate);
  void sprintId; // kept on the prop for symmetry; sprintName is the displayed value
  return (
    <Link
      href={`/b/${boardId}/c/${cardId}`}
      data-testid="all-tasks-card"
      data-card-id={cardId}
      data-board-id={boardId}
      data-list-id={listId}
      className="block rounded-md border border-hairline bg-[color:var(--surface)] hover:bg-[rgb(255_255_255/0.04)] transition-colors p-2.5 space-y-2"
    >
      <div className="text-sm leading-snug text-fg">{title}</div>
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
    </Link>
  );
}
