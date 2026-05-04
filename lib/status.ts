// Plan #16b-γ-A (#2) — derive a card's roadmap status from its list's
// `statusKind` column. The mapping is one-to-one: a list with no
// `statusKind` produces null (the bar falls back to the default fill).

export type StatusKind =
  | "todo"
  | "in_progress"
  | "review"
  | "done"
  | "blocked";

// Plan #16b-γ-Gantt-B (B3) — shared human-readable labels for the five
// statusKind values. Used by the Roadmap bar's tooltip and by the Kanban
// tile's status badge. Keep here so both consumers stay in sync without a
// UI→roadmap dep.
export const STATUS_LABEL: Record<StatusKind, string> = {
  todo: "to do",
  in_progress: "in progress",
  review: "review",
  done: "done",
  blocked: "blocked",
};

// Plan #epic-as-kanban — display titles used when auto-creating a list
// for a given status_kind. Mirrors STATUS_LABEL but in title-case for
// list-name (a list called "in progress" lower-case looks wrong).
export const STATUS_DEFAULT_TITLE: Record<StatusKind, string> = {
  todo: "Todo",
  in_progress: "In progress",
  review: "Review",
  done: "Done",
  blocked: "Blocked",
};

type CardLike = { listId: string };
type ListLike = { id: string; statusKind: StatusKind | null };

/**
 * Returns the StatusKind associated with the card's current list, or null
 * when the list is unmapped (or the card's list isn't in the provided
 * lookup — which can happen briefly during a list-deletion CDC race).
 */
export function getCardStatusKind(
  card: CardLike,
  lists: ListLike[],
): StatusKind | null {
  const l = lists.find((x) => x.id === card.listId);
  return l?.statusKind ?? null;
}
