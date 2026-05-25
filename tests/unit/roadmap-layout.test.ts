import { describe, it, expect } from "vitest";
import {
  groupByAssignee,
  groupByComponent,
  groupBySubBoard,
  stackInLane,
  type RoadmapCard,
  type SubBoardRef,
} from "@/lib/roadmap/layout";

const card = (over: Partial<RoadmapCard> = {}): RoadmapCard => ({
  id: over.id ?? "c",
  title: over.title ?? "C",
  type: over.type ?? "story",
  parentCardId: over.parentCardId ?? null,
  startDate: over.startDate ?? new Date("2026-05-01T00:00:00Z"),
  targetDate: over.targetDate ?? new Date("2026-05-05T00:00:00Z"),
  boardId: over.boardId ?? "B",
});

describe("groupBySubBoard", () => {
  const sub = (over: Partial<SubBoardRef>): SubBoardRef => ({
    id: over.id ?? "sb",
    title: over.title ?? "Sub-board",
    parentCardId: over.parentCardId ?? null,
  });

  it("creates one lane per sub-board + one merged lane per orphan board", () => {
    // Anchor card lives on the parent board "B"; its sub-board is "sb1".
    const anchor = card({ id: "e1", title: "Anchor A", boardId: "B" });
    // Child lives inside the sub-board (boardId = sub-board id).
    const s1 = card({ id: "s1", boardId: "sb1" });
    // Orphan: top-level card not in any sub-board, no anchor wiring.
    const s2 = card({ id: "s2", boardId: "B" });
    const lanes = groupBySubBoard(
      [anchor, s1, s2],
      [sub({ id: "sb1", title: "Sub A", parentCardId: "e1" })],
    );
    expect(lanes.find((l) => l.id === "sb1")?.cards.map((c) => c.id)).toEqual([
      "s1",
    ]);
    // Orphan lane is keyed by its parent board id; the orphan card sits in
    // lane.cards (no header card — board name is the lane label).
    const orphanLane = lanes.find((l) => l.id === "B");
    expect(orphanLane?.headerCard).toBeNull();
    expect(orphanLane?.cards.map((c) => c.id)).toEqual(["s2"]);
  });

  it("merges multiple orphan cards on the same board into one lane", () => {
    const a = card({ id: "a", title: "A", boardId: "B" });
    const b = card({
      id: "b",
      title: "B",
      boardId: "B",
      startDate: new Date("2026-05-10T00:00:00Z"),
      targetDate: new Date("2026-05-15T00:00:00Z"),
    });
    const c = card({
      id: "c",
      title: "C",
      boardId: "B",
      startDate: new Date("2026-05-20T00:00:00Z"),
      targetDate: new Date("2026-05-25T00:00:00Z"),
    });
    const lanes = groupBySubBoard([a, b, c], [], [{ id: "B", title: "General" }]);
    expect(lanes).toHaveLength(1);
    expect(lanes[0].id).toBe("B");
    expect(lanes[0].title).toBe("General");
    expect(lanes[0].kind).toBe("uncategorized");
    expect(lanes[0].cards.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps separate lanes for orphans that live on different boards", () => {
    const a = card({ id: "a", boardId: "B1" });
    const b = card({ id: "b", boardId: "B2" });
    const lanes = groupBySubBoard(
      [a, b],
      [],
      [
        { id: "B1", title: "Board One" },
        { id: "B2", title: "Board Two" },
      ],
    );
    expect(lanes).toHaveLength(2);
    expect(lanes.map((l) => l.id).sort()).toEqual(["B1", "B2"]);
  });

  it("uses the anchor card as the lane header", () => {
    const anchor = card({ id: "e1", title: "Anchor A", boardId: "B" });
    const lanes = groupBySubBoard(
      [anchor],
      [sub({ id: "sb1", title: "Sub A", parentCardId: "e1" })],
    );
    expect(lanes.find((l) => l.id === "sb1")?.headerCard?.id).toBe("e1");
  });

  it("does not place the anchor card into its own lane.cards list", () => {
    const anchor = card({ id: "e1", title: "Anchor A", boardId: "B" });
    const s1 = card({ id: "s1", boardId: "sb1" });
    const lanes = groupBySubBoard(
      [anchor, s1],
      [sub({ id: "sb1", title: "Sub A", parentCardId: "e1" })],
    );
    const lane = lanes.find((l) => l.id === "sb1")!;
    expect(lane.cards.map((c) => c.id)).toEqual(["s1"]);
    expect(lane.headerCard?.id).toBe("e1");
  });

  it("orders sub-board lanes alphabetically by anchor title with orphan lanes last", () => {
    const anchorB = card({ id: "eb", title: "Beta", boardId: "B" });
    const anchorA = card({ id: "ea", title: "Alpha", boardId: "B" });
    const orphan = card({ id: "s1", title: "Orphan", boardId: "B" });
    const lanes = groupBySubBoard(
      [orphan, anchorB, anchorA],
      [
        sub({ id: "sbb", parentCardId: "eb" }),
        sub({ id: "sba", parentCardId: "ea" }),
      ],
    );
    // Orphan lane is keyed by the orphan's board id ("B"), not the card id.
    expect(lanes.map((l) => l.id)).toEqual(["sba", "sbb", "B"]);
  });

  it("does not emit any orphan lane when every visible card belongs to a sub-board lane", () => {
    const anchorA = card({ id: "ea", title: "Alpha", boardId: "B" });
    const s1 = card({ id: "s1", boardId: "sba" });
    const lanes = groupBySubBoard(
      [anchorA, s1],
      [sub({ id: "sba", parentCardId: "ea" })],
    );
    expect(lanes.map((l) => l.id)).toEqual(["sba"]);
  });

  it("sub-board lanes use kind=sub_board; orphan lanes use kind=uncategorized", () => {
    const anchorA = card({ id: "ea", title: "Alpha", boardId: "B" });
    const orphan = card({ id: "s1", boardId: "B" });
    const lanes = groupBySubBoard(
      [anchorA, orphan],
      [sub({ id: "sba", parentCardId: "ea" })],
    );
    expect(lanes.find((l) => l.id === "sba")?.kind).toBe("sub_board");
    expect(lanes.find((l) => l.id === "B")?.kind).toBe("uncategorized");
  });

  it("skips sub-boards whose anchor card is not in the cards input", () => {
    // Sub-board points at an anchor card we don't have — it's hidden, not
    // an error. Falls back to orphan lane keyed by the orphan's board id.
    const orphan = card({ id: "s1", boardId: "B" });
    const lanes = groupBySubBoard(
      [orphan],
      [sub({ id: "sba", parentCardId: "missing-anchor" })],
    );
    expect(lanes.map((l) => l.id)).toEqual(["B"]);
  });

  it("orphan lane title uses parent board name when boards map is supplied", () => {
    const orphan = card({ id: "s1", title: "Some Card", boardId: "B" });
    const lanes = groupBySubBoard(
      [orphan],
      [],
      [{ id: "B", title: "General" }],
    );
    expect(lanes).toHaveLength(1);
    expect(lanes[0].id).toBe("B");
    expect(lanes[0].title).toBe("General");
    expect(lanes[0].headerCard).toBeNull();
    expect(lanes[0].cards.map((c) => c.id)).toEqual(["s1"]);
  });

  it("orphan lane falls back to first card title when board id is not in boards map", () => {
    const orphan = card({ id: "s1", title: "Some Card", boardId: "B" });
    const lanes = groupBySubBoard([orphan], [], [{ id: "OTHER", title: "X" }]);
    expect(lanes[0].title).toBe("Some Card");
  });

  it("orphan lane falls back to first card title when no boards map is supplied", () => {
    const orphan = card({ id: "s1", title: "Some Card", boardId: "B" });
    const lanes = groupBySubBoard([orphan], []);
    expect(lanes[0].title).toBe("Some Card");
  });
});

describe("groupByAssignee", () => {
  const profiles = [
    { id: "u1", displayName: "Alice" },
    { id: "u2", displayName: "Bob" },
  ];

  it("places visible cards in Unassigned when there are no card_members", () => {
    const c1 = card({ id: "c1" });
    const c2 = card({ id: "c2" });
    const lanes = groupByAssignee([c1, c2], [], profiles);
    expect(lanes.map((l) => l.id)).toEqual(["assignee:unassigned"]);
    expect(lanes[0].cards.map((c) => c.id).sort()).toEqual(["c1", "c2"]);
    expect(lanes[0].kind).toBe("assignee");
  });

  it("groups two cards under one assignee into a single lane", () => {
    const c1 = card({ id: "c1" });
    const c2 = card({ id: "c2" });
    const members = [
      { cardId: "c1", userId: "u1" },
      { cardId: "c2", userId: "u1" },
    ];
    const lanes = groupByAssignee([c1, c2], members, profiles);
    expect(lanes.map((l) => l.id)).toEqual(["assignee:u1"]);
    expect(lanes[0].title).toBe("Alice");
    expect(lanes[0].cards.map((c) => c.id).sort()).toEqual(["c1", "c2"]);
  });

  it("duplicates a card into each assignee lane when it has multiple assignees", () => {
    const c1 = card({ id: "c1" });
    const members = [
      { cardId: "c1", userId: "u1" },
      { cardId: "c1", userId: "u2" },
    ];
    const lanes = groupByAssignee([c1], members, profiles);
    expect(lanes.map((l) => l.id)).toEqual(["assignee:u1", "assignee:u2"]);
    expect(lanes[0].cards.map((c) => c.id)).toEqual(["c1"]);
    expect(lanes[1].cards.map((c) => c.id)).toEqual(["c1"]);
  });

  it("falls back to title 'Unknown' when the profile is missing for a userId", () => {
    const c1 = card({ id: "c1" });
    const members = [{ cardId: "c1", userId: "u-missing" }];
    const lanes = groupByAssignee([c1], members, profiles);
    expect(lanes.map((l) => l.id)).toEqual(["assignee:u-missing"]);
    expect(lanes[0].title).toBe("Unknown");
  });

  it("emits Unassigned only when at least one visible card has no assignees", () => {
    const c1 = card({ id: "c1" });
    const c2 = card({ id: "c2" });
    const members = [{ cardId: "c1", userId: "u1" }];
    const lanes = groupByAssignee([c1, c2], members, profiles);
    const ids = lanes.map((l) => l.id);
    expect(ids).toContain("assignee:u1");
    expect(ids).toContain("assignee:unassigned");
  });

  it("skips subtasks (rendered nested under parent in sub-board mode)", () => {
    const subT = card({ id: "s1", type: "subtask", parentCardId: "x" });
    const story = card({ id: "c1" });
    const members = [
      { cardId: "s1", userId: "u1" },
      { cardId: "c1", userId: "u1" },
    ];
    const lanes = groupByAssignee([subT, story], members, profiles);
    expect(lanes.map((l) => l.id)).toEqual(["assignee:u1"]);
    expect(lanes[0].cards.map((c) => c.id)).toEqual(["c1"]);
  });

  it("orders assignee lanes alphabetically by display name", () => {
    const ca = card({ id: "ca" });
    const cb = card({ id: "cb" });
    const members = [
      { cardId: "ca", userId: "u2" }, // Bob
      { cardId: "cb", userId: "u1" }, // Alice
    ];
    const lanes = groupByAssignee([ca, cb], members, profiles);
    expect(lanes.map((l) => l.title)).toEqual(["Alice", "Bob"]);
  });
});

describe("groupByComponent", () => {
  const components = [
    { id: "k1", name: "Frontend" },
    { id: "k2", name: "Backend" },
  ];

  it("places visible cards in Uncomponented when there are no card_components", () => {
    const c1 = card({ id: "c1" });
    const c2 = card({ id: "c2" });
    const lanes = groupByComponent([c1, c2], [], components);
    expect(lanes.map((l) => l.id)).toEqual(["component:uncomponented"]);
    expect(lanes[0].cards.map((c) => c.id).sort()).toEqual(["c1", "c2"]);
    expect(lanes[0].kind).toBe("component");
    expect(lanes[0].title).toBe("Uncomponented");
  });

  it("groups two cards under one component into a single lane", () => {
    const c1 = card({ id: "c1" });
    const c2 = card({ id: "c2" });
    const cardComponents = [
      { cardId: "c1", componentId: "k1" },
      { cardId: "c2", componentId: "k1" },
    ];
    const lanes = groupByComponent([c1, c2], cardComponents, components);
    expect(lanes.map((l) => l.id)).toEqual(["component:k1"]);
    expect(lanes[0].title).toBe("Frontend");
    expect(lanes[0].cards.map((c) => c.id).sort()).toEqual(["c1", "c2"]);
  });

  it("duplicates a card into each component lane when it has multiple components", () => {
    const c1 = card({ id: "c1" });
    const cardComponents = [
      { cardId: "c1", componentId: "k1" },
      { cardId: "c1", componentId: "k2" },
    ];
    const lanes = groupByComponent([c1], cardComponents, components);
    // Sorted alphabetically: Backend (k2) before Frontend (k1).
    expect(lanes.map((l) => l.id)).toEqual(["component:k2", "component:k1"]);
    expect(lanes[0].cards.map((c) => c.id)).toEqual(["c1"]);
    expect(lanes[1].cards.map((c) => c.id)).toEqual(["c1"]);
  });

  it("falls back to title 'Unknown' when the component is missing for a componentId", () => {
    const c1 = card({ id: "c1" });
    const cardComponents = [{ cardId: "c1", componentId: "k-missing" }];
    const lanes = groupByComponent([c1], cardComponents, components);
    expect(lanes.map((l) => l.id)).toEqual(["component:k-missing"]);
    expect(lanes[0].title).toBe("Unknown");
  });

  it("emits Uncomponented only when at least one visible card has no components", () => {
    const c1 = card({ id: "c1" });
    const c2 = card({ id: "c2" });
    const cardComponents = [{ cardId: "c1", componentId: "k1" }];
    const lanes = groupByComponent([c1, c2], cardComponents, components);
    const ids = lanes.map((l) => l.id);
    expect(ids).toContain("component:k1");
    expect(ids).toContain("component:uncomponented");
  });

  it("skips subtasks (rendered nested under parent in sub-board mode)", () => {
    const subT = card({ id: "s1", type: "subtask", parentCardId: "x" });
    const story = card({ id: "c1" });
    const cardComponents = [
      { cardId: "s1", componentId: "k1" },
      { cardId: "c1", componentId: "k1" },
    ];
    const lanes = groupByComponent([subT, story], cardComponents, components);
    expect(lanes.map((l) => l.id)).toEqual(["component:k1"]);
    expect(lanes[0].cards.map((c) => c.id)).toEqual(["c1"]);
  });

  it("orders component lanes alphabetically by component name", () => {
    const ca = card({ id: "ca" });
    const cb = card({ id: "cb" });
    const cardComponents = [
      { cardId: "ca", componentId: "k1" }, // Frontend
      { cardId: "cb", componentId: "k2" }, // Backend
    ];
    const lanes = groupByComponent([ca, cb], cardComponents, components);
    expect(lanes.map((l) => l.title)).toEqual(["Backend", "Frontend"]);
  });
});

describe("stackInLane", () => {
  it("stacks overlapping cards onto separate sub-rows", () => {
    const a = card({
      id: "a",
      startDate: new Date("2026-05-01T00:00:00Z"),
      targetDate: new Date("2026-05-10T00:00:00Z"),
    });
    const b = card({
      id: "b",
      startDate: new Date("2026-05-05T00:00:00Z"),
      targetDate: new Date("2026-05-15T00:00:00Z"),
    });
    const c = card({
      id: "c",
      startDate: new Date("2026-05-16T00:00:00Z"),
      targetDate: new Date("2026-05-20T00:00:00Z"),
    });
    const placed = stackInLane([a, b, c]);
    expect(placed.find((p) => p.card.id === "a")?.row).toBe(0);
    expect(placed.find((p) => p.card.id === "b")?.row).toBe(1);
    // c starts after b ends so it falls back to row 0.
    expect(placed.find((p) => p.card.id === "c")?.row).toBe(0);
  });

  it("returns empty array for empty input", () => {
    expect(stackInLane([])).toEqual([]);
  });

  it("two non-overlapping cards both land on row 0", () => {
    const a = card({
      id: "a",
      startDate: new Date("2026-05-01T00:00:00Z"),
      targetDate: new Date("2026-05-05T00:00:00Z"),
    });
    const b = card({
      id: "b",
      startDate: new Date("2026-05-06T00:00:00Z"),
      targetDate: new Date("2026-05-10T00:00:00Z"),
    });
    const placed = stackInLane([a, b]);
    expect(placed.every((p) => p.row === 0)).toBe(true);
  });
});
