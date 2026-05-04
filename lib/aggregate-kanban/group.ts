// Plan #aggregate-kanban — group workspace cards by their list's statusKind
// for the cross-board "My tasks" view. Pure helpers: no store reads, no
// React, no I/O. Layouts use exactly the same column model as the Kanban
// status mapping (`lists.statusKind` enum) plus an "unmapped" sink for
// cards whose list has no statusKind set.

export type StatusKind =
  | "todo"
  | "in_progress"
  | "review"
  | "done"
  | "blocked";
export type AggregateColumnId = StatusKind | "unmapped";

export const AGGREGATE_COLUMNS: ReadonlyArray<{
  id: AggregateColumnId;
  label: string;
}> = [
  { id: "todo", label: "TO DO" },
  { id: "in_progress", label: "IN PROGRESS" },
  { id: "review", label: "REVIEW" },
  { id: "done", label: "DONE" },
  { id: "blocked", label: "BLOCKED" },
  { id: "unmapped", label: "NO STATUS" },
];

type CardLite = {
  id: string;
  boardId: string;
  listId: string;
  archived: boolean;
};
type ListLite = {
  id: string;
  boardId: string;
  position?: string;
  statusKind: StatusKind | null;
};

export type GroupResult<C extends CardLite = CardLite> = Record<
  AggregateColumnId,
  C[]
>;

export function groupByStatus<C extends CardLite, L extends ListLite>(
  cards: C[],
  lists: L[],
): GroupResult<C> {
  const listById = new Map(lists.map((l) => [l.id, l]));
  const out: GroupResult<C> = {
    todo: [],
    in_progress: [],
    review: [],
    done: [],
    blocked: [],
    unmapped: [],
  };
  for (const c of cards) {
    if (c.archived) continue;
    const l = listById.get(c.listId);
    if (!l) continue;
    const col: AggregateColumnId = l.statusKind ?? "unmapped";
    out[col].push(c);
  }
  return out;
}

/**
 * Returns the first list (in argument order) on `boardId` whose statusKind
 * matches `target`. Callers MUST sort `lists` by `position` ascending
 * before calling — the view layer does this, and the result then represents
 * the visually-first matching list.
 *
 * Returns `null` when:
 *   - target is `"unmapped"` (no semantic destination — drop is rejected)
 *   - no list on the board carries that statusKind
 */
export function findTargetListId<L extends ListLite>(
  lists: L[],
  boardId: string,
  target: AggregateColumnId,
): string | null {
  if (target === "unmapped") return null;
  for (const l of lists) {
    if (l.boardId === boardId && l.statusKind === target) return l.id;
  }
  return null;
}
