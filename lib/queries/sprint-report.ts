// Pure aggregation helpers for the sprint completion report. Kept
// data-source-agnostic so tests can pin behaviour without touching the
// DB. The report page composes these on top of `computeBurndown` and
// `computeVelocity` from `sprints-stats.ts`.

export type SprintReportInputCard = {
  id: string;
  storyPoints: number | null;
  completedAt: Date | null;
};

export type SprintReportInputHistory = {
  cardId: string;
  assignedAt: Date;
};

export type SprintReportAggregates = {
  // Map<cardId, { addedMidSprint, completedInSprint }>. Per-card flags
  // the page uses to bucket cards into "done" / "carried over" lists.
  byCard: Map<string, { addedMidSprint: boolean; completedInSprint: boolean }>;
  committedPoints: number;
  cardsCompleted: number;
  cardsAddedMidSprint: number;
  cardsCarriedOver: number;
};

const ADDED_MID_SPRINT_GRACE_MS = 60 * 60 * 1000; // 1 hour

/**
 * A card is "added mid-sprint" iff it has a card_sprint_history row on
 * THIS sprint whose earliest assignedAt is more than `grace` after the
 * sprint's startDate. Cards present at sprint start (and cards with no
 * history rows for this sprint, which we treat as "always there") are
 * NOT added mid-sprint. The 1-hour grace absorbs clock skew between
 * sprint.startDate (a user-set day boundary) and assignment timestamps.
 *
 * "completedInSprint" means cards.completed_at falls inside the closed
 * window [sprint.startDate, sprint.completedAt ?? sprint.endDate].
 * Cards completed AFTER the sprint closed (or never completed) are
 * counted as carried-over.
 */
export function aggregateSprintReport(
  sprintCards: ReadonlyArray<SprintReportInputCard>,
  history: ReadonlyArray<SprintReportInputHistory>,
  sprint: {
    startDate: Date | null;
    endDate: Date | null;
    completedAt: Date | null;
  },
  options: { graceMs?: number } = {},
): SprintReportAggregates {
  const grace = options.graceMs ?? ADDED_MID_SPRINT_GRACE_MS;
  const start = sprint.startDate;
  const end = sprint.completedAt ?? sprint.endDate;

  const firstAssigned = new Map<string, Date>();
  for (const h of history) {
    const at = h.assignedAt instanceof Date ? h.assignedAt : new Date(h.assignedAt);
    const prev = firstAssigned.get(h.cardId);
    if (!prev || at < prev) firstAssigned.set(h.cardId, at);
  }

  const byCard = new Map<
    string,
    { addedMidSprint: boolean; completedInSprint: boolean }
  >();
  let cardsCompleted = 0;
  let cardsAddedMidSprint = 0;
  let cardsCarriedOver = 0;
  let committedPoints = 0;

  for (const c of sprintCards) {
    const fa = firstAssigned.get(c.id) ?? null;
    const addedMidSprint = !!(
      start &&
      fa &&
      fa.getTime() > start.getTime() + grace
    );
    const completedAt = c.completedAt
      ? c.completedAt instanceof Date
        ? c.completedAt
        : new Date(c.completedAt)
      : null;
    const completedInSprint = !!(
      completedAt &&
      start &&
      end &&
      completedAt >= start &&
      completedAt <= end
    );

    byCard.set(c.id, { addedMidSprint, completedInSprint });

    if (addedMidSprint) cardsAddedMidSprint += 1;
    else committedPoints += c.storyPoints ?? 0;

    if (completedInSprint) cardsCompleted += 1;
    else cardsCarriedOver += 1;
  }

  return {
    byCard,
    committedPoints,
    cardsCompleted,
    cardsAddedMidSprint,
    cardsCarriedOver,
  };
}

/**
 * Completion-rate percent, rounded. Uses committed points as the
 * denominator when known (preferred, since it matches "did we deliver
 * what we promised?"); falls back to total points when committed is 0
 * (e.g. sprint had no cards at start, all added mid-sprint), and to 0
 * when neither is available.
 */
export function completionRate(
  completedPoints: number,
  committedPoints: number,
  totalPoints: number,
): number {
  if (committedPoints > 0)
    return Math.round((completedPoints / committedPoints) * 100);
  if (totalPoints > 0) return Math.round((completedPoints / totalPoints) * 100);
  return 0;
}
