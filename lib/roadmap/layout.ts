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
  // Plan #16b-γ-G G1 — optional manual roadmap row order. NULL = unranked
  // (lanes fall back to alphabetical title sort). Sparse-int ranks set
  // by drag reorder.
  roadmapOrder?: number | null;
};

export type Lane<C extends RoadmapCard = RoadmapCard> = {
  id: string;
  title: string;
  kind: "epic" | "uncategorized" | "assignee" | "component";
  /** The epic card itself (header bar). Null for the Uncategorized lane. */
  headerCard: C | null;
  /** Children of this epic (or orphan stories for Uncategorized). */
  cards: C[];
  /**
   * Plan #16b-β — subtasks (`type === "subtask"`) grouped by `parentCardId`,
   * pre-stacked into rows. Empty record if no subtasks have dates set in
   * this lane. The RoadmapView reads this map when rendering expanded
   * parent rows.
   */
  subtaskRowsByParent: Record<string, Array<PlacedCard<C>[]>>;
};

export const UNCATEGORIZED_LANE_ID = "uncategorized";

export function groupByEpic<C extends RoadmapCard>(cards: C[]): Lane<C>[] {
  const epics = new Map<string, C>();
  const childrenByEpic = new Map<string, C[]>();
  const orphans: C[] = [];
  // Plan #16b-β — collect subtasks separately so they don't appear as their
  // own rows alongside parent stories. They're rendered as nested children
  // when the user expands the parent.
  const subtasksByParent = new Map<string, C[]>();
  // Build a quick id -> card lookup for resolving subtask parents.
  const cardById = new Map(cards.map((c) => [c.id, c]));

  for (const c of cards) {
    if (c.type === "epic") {
      epics.set(c.id, c);
      if (!childrenByEpic.has(c.id)) childrenByEpic.set(c.id, []);
    }
  }
  for (const c of cards) {
    if (c.type === "epic") continue;
    if (c.type === "subtask") {
      if (c.parentCardId) {
        const arr = subtasksByParent.get(c.parentCardId) ?? [];
        arr.push(c);
        subtasksByParent.set(c.parentCardId, arr);
      }
      continue;
    }
    if (c.parentCardId && epics.has(c.parentCardId)) {
      childrenByEpic.get(c.parentCardId)!.push(c);
    } else {
      orphans.push(c);
    }
  }

  // For each lane, pre-stack subtask groups whose parent lives in that lane.
  function subtaskRowsFor(laneCardIds: Iterable<string>): Record<string, Array<PlacedCard<C>[]>> {
    const out: Record<string, Array<PlacedCard<C>[]>> = {};
    for (const parentId of laneCardIds) {
      const subs = subtasksByParent.get(parentId);
      if (!subs || subs.length === 0) continue;
      // Group subtasks for this parent into rows (greedy stacking).
      const placed = stackInLane(subs);
      const rows: Array<PlacedCard<C>[]> = [];
      for (const p of placed) {
        if (!rows[p.row]) rows[p.row] = [];
        rows[p.row].push(p);
      }
      out[parentId] = rows;
    }
    return out;
  }

  // Plan #16b-γ-G G1 — sort epics by `roadmapOrder` ASC (NULLS LAST), then
  // title ASC as the tiebreaker. Cards without an explicit rank fall to
  // the bottom of the list, keeping the alphabetical default for any
  // board that has never been manually reordered.
  const epicLanes: Lane<C>[] = [...epics.values()]
    .sort((a, b) => {
      const ar = a.roadmapOrder ?? null;
      const br = b.roadmapOrder ?? null;
      if (ar !== null && br !== null) return ar - br;
      if (ar !== null) return -1;
      if (br !== null) return 1;
      return a.title.localeCompare(b.title);
    })
    .map<Lane<C>>((e) => {
      const laneChildren = childrenByEpic.get(e.id) ?? [];
      const ids: string[] = [e.id, ...laneChildren.map((c) => c.id)];
      return {
        id: e.id,
        title: e.title,
        kind: "epic",
        headerCard: e,
        cards: laneChildren,
        subtaskRowsByParent: subtaskRowsFor(ids),
      };
    });

  // Suppress unused-variable lint hint (cardById may be useful for callers
  // that want to resolve parent metadata; left exported via no public api).
  void cardById;

  if (orphans.length === 0) return epicLanes;

  return [
    ...epicLanes,
    {
      id: UNCATEGORIZED_LANE_ID,
      title: "Uncategorized",
      kind: "uncategorized",
      headerCard: null,
      cards: orphans,
      subtaskRowsByParent: subtaskRowsFor(orphans.map((c) => c.id)),
    },
  ];
}

/**
 * Plan #16b-γ-Gantt-Master Group C (C9) — alternate lane mode that groups
 * roadmap bars by assignee instead of by epic. One lane per user that has
 * any visible card assigned; cards with multiple assignees appear in EACH
 * assignee's lane (intentional — useful for capacity reading). An
 * "Unassigned" lane is appended only when at least one visible card has no
 * assignees. Subtasks are intentionally excluded in v1: in epic mode they
 * render under their parent (`subtaskRowsByParent`), but resolving the
 * "right" parent in assignee mode is out of scope here. Epics are also
 * skipped — their assignee-set is rarely meaningful and they'd dominate
 * lanes if included.
 */
export function groupByAssignee<C extends RoadmapCard>(
  cards: C[],
  cardMembers: Array<{ cardId: string; userId: string }>,
  profiles: Array<{ id: string; displayName: string }>,
): Lane<C>[] {
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const assigneesByCard = new Map<string, string[]>();
  for (const m of cardMembers) {
    const arr = assigneesByCard.get(m.cardId) ?? [];
    arr.push(m.userId);
    assigneesByCard.set(m.cardId, arr);
  }

  const cardsByUser = new Map<string, C[]>();
  const unassigned: C[] = [];
  for (const c of cards) {
    if (c.type === "epic") continue;
    if (c.type === "subtask") continue;
    const userIds = assigneesByCard.get(c.id) ?? [];
    if (userIds.length === 0) {
      unassigned.push(c);
    } else {
      for (const uid of userIds) {
        const arr = cardsByUser.get(uid) ?? [];
        arr.push(c);
        cardsByUser.set(uid, arr);
      }
    }
  }

  const lanes: Lane<C>[] = [...cardsByUser.entries()]
    .map(([userId, laneCards]) => ({
      userId,
      title: profileById.get(userId)?.displayName ?? "Unknown",
      cards: laneCards,
    }))
    .sort((a, b) => a.title.localeCompare(b.title))
    .map<Lane<C>>(({ userId, title, cards: laneCards }) => ({
      id: `assignee:${userId}`,
      title,
      kind: "assignee",
      headerCard: null,
      cards: laneCards,
      subtaskRowsByParent: {},
    }));

  if (unassigned.length > 0) {
    lanes.push({
      id: "assignee:unassigned",
      title: "Unassigned",
      kind: "assignee",
      headerCard: null,
      cards: unassigned,
      subtaskRowsByParent: {},
    });
  }

  return lanes;
}

/**
 * Plan #16b-γ-Gantt-Master Group C (C10) — alternate lane mode that groups
 * roadmap bars by component instead of by epic / assignee. One lane per
 * component that has any visible card tagged; cards with multiple components
 * appear in EACH component's lane (intentional — a card legitimately belongs
 * to all its component lanes). An "Uncomponented" lane is appended only when
 * at least one visible card has no component. Subtasks and epics are skipped
 * for the same reasons as `groupByAssignee` — subtasks render under their
 * parent in epic mode, and epics' component sets are rarely meaningful.
 */
export function groupByComponent<C extends RoadmapCard>(
  cards: C[],
  cardComponents: Array<{ cardId: string; componentId: string }>,
  components: Array<{ id: string; name: string }>,
): Lane<C>[] {
  const componentById = new Map(components.map((c) => [c.id, c]));
  const componentsByCard = new Map<string, string[]>();
  for (const cc of cardComponents) {
    const arr = componentsByCard.get(cc.cardId) ?? [];
    arr.push(cc.componentId);
    componentsByCard.set(cc.cardId, arr);
  }

  const cardsByComponent = new Map<string, C[]>();
  const uncomponented: C[] = [];
  for (const c of cards) {
    if (c.type === "epic") continue;
    if (c.type === "subtask") continue;
    const componentIds = componentsByCard.get(c.id) ?? [];
    if (componentIds.length === 0) {
      uncomponented.push(c);
    } else {
      for (const cid of componentIds) {
        const arr = cardsByComponent.get(cid) ?? [];
        arr.push(c);
        cardsByComponent.set(cid, arr);
      }
    }
  }

  const lanes: Lane<C>[] = [...cardsByComponent.entries()]
    .map(([componentId, laneCards]) => ({
      componentId,
      title: componentById.get(componentId)?.name ?? "Unknown",
      cards: laneCards,
    }))
    .sort((a, b) => a.title.localeCompare(b.title))
    .map<Lane<C>>(({ componentId, title, cards: laneCards }) => ({
      id: `component:${componentId}`,
      title,
      kind: "component",
      headerCard: null,
      cards: laneCards,
      subtaskRowsByParent: {},
    }));

  if (uncomponented.length > 0) {
    lanes.push({
      id: "component:uncomponented",
      title: "Uncomponented",
      kind: "component",
      headerCard: null,
      cards: uncomponented,
      subtaskRowsByParent: {},
    });
  }

  return lanes;
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
