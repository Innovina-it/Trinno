import type { Filters } from "@/lib/board-filters";

export type RoadmapFilterCard = {
  id: string;
  title: string;
  archived: boolean;
  type?: string | null;
  parentCardId?: string | null;
  sprintId?: string | null;
  dueDate?: Date | string | null;
  dueComplete?: boolean | null;
  startDate?: Date | string | null;
  targetDate?: Date | string | null;
  ownerId?: string | null;
};

export function isRoadmapAssignedToViewer(
  card: RoadmapFilterCard,
  memberByCard: Map<string, Set<string>>,
  viewerId: string | null | undefined,
): boolean {
  if (!viewerId) return false;
  if (card.ownerId === viewerId) return true;
  return memberByCard.get(card.id)?.has(viewerId) ?? false;
}

export function isRoadmapUnassigned(
  card: RoadmapFilterCard,
  memberByCard: Map<string, Set<string>>,
): boolean {
  const hasMembers = (memberByCard.get(card.id)?.size ?? 0) > 0;
  return !card.ownerId && !hasMembers;
}

export function roadmapUserFilterPasses(
  card: RoadmapFilterCard,
  input: {
    queryNorm: string;
    filters: Filters;
    sprintFilter: string;
    viewerId?: string | null;
    memberByCard: Map<string, Set<string>>;
    now?: Date;
  },
): boolean {
  const { queryNorm, filters, sprintFilter, viewerId, memberByCard } = input;
  if (card.archived) return false;
  if (queryNorm && !card.title.toLowerCase().includes(queryNorm)) return false;

  const selectedTypes = filters.types;
  if (selectedTypes.length) {
    const subtaskAllowed = selectedTypes.includes("subtask");
    const parentTypes = selectedTypes.filter((t) => t !== "subtask");
    if (card.type === "subtask") {
      if (!subtaskAllowed) return false;
    } else if (parentTypes.length && !parentTypes.includes(card.type ?? "task")) {
      return false;
    }
  }

  if (sprintFilter && card.sprintId !== sprintFilter) return false;
  if (filters.due === "overdue") {
    const due = card.dueDate
      ? card.dueDate instanceof Date
        ? card.dueDate
        : new Date(card.dueDate)
      : null;
    const now = input.now ?? new Date();
    if (!due || due > now || card.dueComplete) return false;
  }
  if (filters.assignedToMe) {
    if (!isRoadmapAssignedToViewer(card, memberByCard, viewerId)) return false;
  }
  if (filters.unassigned && !isRoadmapUnassigned(card, memberByCard)) {
    return false;
  }
  return true;
}

export function countMineHiddenRoadmapCards(
  cards: RoadmapFilterCard[],
  input: {
    queryNorm: string;
    filters: Filters;
    sprintFilter: string;
    viewerId?: string | null;
    memberByCard: Map<string, Set<string>>;
    now?: Date;
    requireScheduled?: boolean;
  },
): number {
  if (!input.filters.assignedToMe) return 0;
  const withoutMine: Filters = {
    ...input.filters,
    assignedToMe: false,
    unassigned: false,
  };
  let count = 0;
  for (const card of cards) {
    if (
      input.requireScheduled &&
      (card.startDate === null ||
        card.startDate === undefined ||
        card.targetDate === null ||
        card.targetDate === undefined)
    ) {
      continue;
    }
    if (
      roadmapUserFilterPasses(card, {
        ...input,
        filters: withoutMine,
      }) &&
      !roadmapUserFilterPasses(card, input)
    ) {
      count++;
    }
  }
  return count;
}
