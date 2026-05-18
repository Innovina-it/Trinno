// Plan #13 — pure lane / stack layout for the Roadmap timeline.
// Group flat list of roadmap cards by sub-board, stack overlapping bars into
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

// Minimal sub-board shape consumed by groupBySubBoard. The sub-board's
// `parentCardId` is the card it's attached to (via boards.parent_card_id
// from migration 0105); that anchor card becomes the lane header.
export type SubBoardRef = {
  id: string;
  title: string;
  parentCardId: string | null;
};

export type Lane<C extends RoadmapCard = RoadmapCard> = {
  id: string;
  title: string;
  kind: "sub_board" | "uncategorized" | "assignee" | "component";
  /** The card the lane is anchored to (sub-board's anchor card). Null when n/a. */
  headerCard: C | null;
  /** Children that live inside the lane's sub-board (or empty for orphan/self-lanes). */
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

export function groupBySubBoard<C extends RoadmapCard>(
  cards: C[],
  subBoards: SubBoardRef[],
): Lane<C>[] {
  const cardById = new Map(cards.map((c) => [c.id, c]));

  // Sub-boards whose anchor card is in the input set. A sub-board without a
  // visible anchor is silently skipped (it can't render a header).
  const visibleSubBoards = subBoards.filter(
    (s) => s.parentCardId !== null && cardById.has(s.parentCardId),
  );
  const anchorIdToSubBoard = new Map<string, SubBoardRef>(
    visibleSubBoards.map((s) => [s.parentCardId as string, s]),
  );
  const subBoardIdToRef = new Map<string, SubBoardRef>(
    visibleSubBoards.map((s) => [s.id, s]),
  );

  const childrenBySubBoardId = new Map<string, C[]>();
  const orphans: C[] = [];
  // Plan #16b-β — collect subtasks separately so they don't appear as their
  // own rows alongside parent stories. They're rendered as nested children
  // when the user expands the parent.
  const subtasksByParent = new Map<string, C[]>();

  for (const c of cards) {
    if (c.type === "subtask") {
      if (c.parentCardId) {
        const arr = subtasksByParent.get(c.parentCardId) ?? [];
        arr.push(c);
        subtasksByParent.set(c.parentCardId, arr);
      }
      continue;
    }
    // Anchor cards become the lane header — don't also place them in their
    // own lane.cards list.
    if (anchorIdToSubBoard.has(c.id)) continue;
    // Card whose home board IS a visible sub-board → goes into that lane.
    if (subBoardIdToRef.has(c.boardId)) {
      const arr = childrenBySubBoardId.get(c.boardId) ?? [];
      arr.push(c);
      childrenBySubBoardId.set(c.boardId, arr);
      continue;
    }
    orphans.push(c);
  }

  // For each lane, pre-stack subtask groups whose parent lives in that lane.
  function subtaskRowsFor(laneCardIds: Iterable<string>): Record<string, Array<PlacedCard<C>[]>> {
    const out: Record<string, Array<PlacedCard<C>[]>> = {};
    for (const parentId of laneCardIds) {
      const subs = subtasksByParent.get(parentId);
      if (!subs || subs.length === 0) continue;
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

  // Plan #16b-γ-G G1 — sort sub-board lanes by anchor card's `roadmapOrder`
  // ASC (NULLS LAST), then anchor title ASC as the tiebreaker.
  const subBoardLanes: Lane<C>[] = visibleSubBoards
    .map((s) => ({
      sub: s,
      anchor: cardById.get(s.parentCardId as string) as C,
    }))
    .sort((a, b) => {
      const ar = a.anchor.roadmapOrder ?? null;
      const br = b.anchor.roadmapOrder ?? null;
      if (ar !== null && br !== null) return ar - br;
      if (ar !== null) return -1;
      if (br !== null) return 1;
      return a.anchor.title.localeCompare(b.anchor.title);
    })
    .map<Lane<C>>(({ sub, anchor }) => {
      const laneChildren = childrenBySubBoardId.get(sub.id) ?? [];
      const ids: string[] = [anchor.id, ...laneChildren.map((c) => c.id)];
      return {
        id: sub.id,
        title: anchor.title,
        kind: "sub_board",
        headerCard: anchor,
        cards: laneChildren,
        subtaskRowsByParent: subtaskRowsFor(ids),
      };
    });

  // Top-level cards that don't belong to any visible sub-board lane get
  // their OWN single-row self-lane, mirroring how anchor cards become lanes.
  // Subtasks remain nested under their parent via `subtaskRowsByParent`.
  const orphanLanes: Lane<C>[] = orphans
    .slice()
    .sort((a, b) => {
      const ar = a.roadmapOrder ?? null;
      const br = b.roadmapOrder ?? null;
      if (ar !== null && br !== null) return ar - br;
      if (ar !== null) return -1;
      if (br !== null) return 1;
      return a.title.localeCompare(b.title);
    })
    .map<Lane<C>>((c) => ({
      id: c.id,
      title: c.title,
      kind: "uncategorized",
      headerCard: c,
      cards: [],
      subtaskRowsByParent: subtaskRowsFor([c.id]),
    }));

  return [...subBoardLanes, ...orphanLanes];
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

/**
 * Task 11 — Subtask filter must not hide parent tasks.
 *
 * The Roadmap renders each parent (epic / story / task / bug) as its own
 * lane and nests its subtasks under the parent's row via
 * `subtaskRowsByParent`. Earlier the type filter was applied uniformly to
 * BOTH parents and subtasks, so the user-facing "Subtask" checkbox would
 * hide every parent that wasn't itself a subtask — exactly the opposite
 * of what the affordance implies.
 *
 * This helper splits the type filter:
 *
 *   • Parents pass based on the non-subtask types in `selectedTypes`.
 *     If the user only ticked "Subtask", the parent-level filter is
 *     effectively empty → every parent stays visible so its subtasks
 *     have a row to render under.
 *
 *   • Subtasks pass only when "subtask" is explicitly selected. If
 *     "subtask" is unticked, subtasks are removed but parents survive.
 *
 *   • An empty `selectedTypes` (no type filter at all) is the identity
 *     pass-through — every card stays.
 *
 * The function is pure so the filter rule is easy to unit-test alongside
 * the rest of the layout helpers.
 */
export function filterRoadmapCardsByType<C extends RoadmapCard>(
  cards: C[],
  selectedTypes: readonly string[],
): C[] {
  if (selectedTypes.length === 0) return cards;
  const selected = new Set(selectedTypes);
  const subtaskAllowed = selected.has("subtask");
  // Parent-level types = everything the user picked, minus "subtask".
  const parentTypes = new Set<string>();
  for (const t of selected) if (t !== "subtask") parentTypes.add(t);
  return cards.filter((c) => {
    if (c.type === "subtask") return subtaskAllowed;
    // No parent-level types picked means the user only constrained
    // subtasks — every parent passes so its nested subtasks have a home.
    if (parentTypes.size === 0) return true;
    return parentTypes.has(c.type);
  });
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
