// Plan #13 — pure lane / stack layout for the Roadmap timeline.
// Group flat list of roadmap cards by epic, stack overlapping bars into
// vertical sub-rows ("Linear-style"). Both functions are pure so they're
// trivial to unit-test.
//
// `RoadmapCard` is the minimal shape these helpers need; the queries
// helper (`@/lib/queries/roadmap`) returns a superset, which is
// structurally compatible.

export type RoadmapCard = {
  id: string;
  title: string;
  type: string;
  parentCardId: string | null;
  startDate: Date;
  targetDate: Date;
  boardId: string;
};

export type Lane<C extends RoadmapCard = RoadmapCard> = {
  id: string;
  title: string;
  kind: "epic" | "uncategorized";
  /** The epic card itself (header bar). Null for the Uncategorized lane. */
  headerCard: C | null;
  /** Children of this epic (or orphan stories for Uncategorized). */
  cards: C[];
};

export const UNCATEGORIZED_LANE_ID = "uncategorized";

export function groupByEpic<C extends RoadmapCard>(cards: C[]): Lane<C>[] {
  const epics = new Map<string, C>();
  const childrenByEpic = new Map<string, C[]>();
  const orphans: C[] = [];

  for (const c of cards) {
    if (c.type === "epic") {
      epics.set(c.id, c);
      if (!childrenByEpic.has(c.id)) childrenByEpic.set(c.id, []);
    }
  }
  for (const c of cards) {
    if (c.type === "epic") continue;
    if (c.parentCardId && epics.has(c.parentCardId)) {
      childrenByEpic.get(c.parentCardId)!.push(c);
    } else {
      orphans.push(c);
    }
  }

  const epicLanes: Lane<C>[] = [...epics.values()]
    .sort((a, b) => a.title.localeCompare(b.title))
    .map<Lane<C>>((e) => ({
      id: e.id,
      title: e.title,
      kind: "epic",
      headerCard: e,
      cards: childrenByEpic.get(e.id) ?? [],
    }));

  if (orphans.length === 0) return epicLanes;

  return [
    ...epicLanes,
    {
      id: UNCATEGORIZED_LANE_ID,
      title: "Uncategorized",
      kind: "uncategorized",
      headerCard: null,
      cards: orphans,
    },
  ];
}

export type PlacedCard<C extends RoadmapCard = RoadmapCard> = {
  card: C;
  row: number;
};

/**
 * Greedy stacking: sort by startDate ascending, then for each card place it
 * in the lowest existing row whose last bar ended at-or-before this card's
 * start. If none qualifies, open a new row.
 */
export function stackInLane<C extends RoadmapCard>(cards: C[]): PlacedCard<C>[] {
  if (cards.length === 0) return [];
  const sorted = [...cards].sort(
    (a, b) => a.startDate.getTime() - b.startDate.getTime(),
  );
  const rowEnds: number[] = []; // last targetDate.getTime() per row
  const placed: PlacedCard<C>[] = [];
  for (const c of sorted) {
    const startMs = c.startDate.getTime();
    let row = rowEnds.findIndex((end) => end <= startMs);
    if (row === -1) {
      row = rowEnds.length;
      rowEnds.push(c.targetDate.getTime());
    } else {
      rowEnds[row] = c.targetDate.getTime();
    }
    placed.push({ card: c, row });
  }
  return placed;
}
