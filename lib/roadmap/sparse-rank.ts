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

/**
 * Local optimistic variant used by the roadmap drag UI. Server writes stay
 * integer-ranked through computeNewRank + transactional renumbering, but the
 * client can receive two rapid local drops before realtime echoes the first
 * write. When the ideal rank is already present in the current snapshot, use a
 * tiny in-gap fractional offset so React sorting remains collision-free until
 * the authoritative server rank arrives.
 */
export function computeOptimisticRank(
  beforeRank: number | null,
  afterRank: number | null,
  occupiedRanks: Iterable<number>,
): number {
  const occupied = new Set(occupiedRanks);
  const base = computeNewRank(beforeRank, afterRank);
  if (!occupied.has(base)) return base;

  const lower = beforeRank ?? base - RANK_STEP;
  const upper = afterRank ?? base + RANK_STEP;
  if (upper <= lower) throw new RankCollisionError();

  const gap = upper - lower;
  for (let i = 1; i <= 64; i++) {
    const offset = gap * (i / 257);
    const up = base + offset;
    if (up < upper && !occupied.has(up)) return up;
    const down = base - offset;
    if (down > lower && !occupied.has(down)) return down;
  }

  throw new RankCollisionError();
}
