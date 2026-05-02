// Plan #16b-γ-G G1 — sparse-int rank algorithm for the manual roadmap row
// order axis. Linear / Jira pattern: ranks are far-apart integers (steps
// of 1024 by default), so most reorders write a single rank without
// touching its neighbours. When neighbours collide (their gap < 2 means
// no integer fits between them) we throw `RankCollisionError` and the
// caller renumbers the board.
//
// Sign convention: smaller rank = higher up in the list. `beforeRank` is
// the rank of the row that lands ABOVE the moved card after the move,
// `afterRank` is the rank of the row BELOW. Either or both may be null
// to denote "drop at top" / "drop at bottom" / "first card on the board".

export const RANK_STEP = 1024;

export class RankCollisionError extends Error {
  constructor() {
    super("rank collision");
    this.name = "RankCollisionError";
  }
}

/**
 * Compute a fresh rank for a card sandwiched between `beforeRank`
 * (above) and `afterRank` (below). Throws `RankCollisionError` if the
 * gap between the two non-null ranks is too small (<2) for an integer
 * midpoint — the caller should then renumber the board with fresh
 * sparse ranks and retry.
 */
export function computeNewRank(
  beforeRank: number | null,
  afterRank: number | null,
): number {
  if (beforeRank === null && afterRank === null) return RANK_STEP;
  if (beforeRank === null) return (afterRank as number) - RANK_STEP;
  if (afterRank === null) return beforeRank + RANK_STEP;
  const mid = Math.floor((beforeRank + afterRank) / 2);
  if (mid === beforeRank || mid === afterRank) {
    throw new RankCollisionError();
  }
  return mid;
}
