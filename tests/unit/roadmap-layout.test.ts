import { describe, it, expect } from "vitest";
import {
  groupByAssignee,
  groupByComponent,
  groupByEpic,
  stackInLane,
  type RoadmapCard,
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

describe("groupByEpic", () => {
  it("creates one lane per epic + a self-lane per orphan story", () => {
    const epic1 = card({
      id: "e1",
      title: "Epic A",
      type: "epic",
      parentCardId: null,
    });
    const s1 = card({ id: "s1", parentCardId: "e1" });
    const s2 = card({ id: "s2", parentCardId: null });
    const lanes = groupByEpic([epic1, s1, s2]);
    expect(lanes.find((l) => l.id === "e1")?.cards.map((c) => c.id)).toEqual([
      "s1",
    ]);
    // Orphans now get their OWN lane (id = card id, headerCard = self).
    const orphanLane = lanes.find((l) => l.id === "s2");
    expect(orphanLane?.headerCard?.id).toBe("s2");
    expect(orphanLane?.cards).toEqual([]);
  });

  it("includes the epic itself as a header bar (own card if dates set)", () => {
    const epic1 = card({
      id: "e1",
      title: "Epic A",
      type: "epic",
      parentCardId: null,
    });
    const lanes = groupByEpic([epic1]);
    expect(lanes.find((l) => l.id === "e1")?.headerCard?.id).toBe("e1");
  });

  it("does not put the epic card itself into the lane.cards list", () => {
    const epic1 = card({ id: "e1", title: "Epic A", type: "epic" });
    const s1 = card({ id: "s1", parentCardId: "e1" });
    const lanes = groupByEpic([epic1, s1]);
    const lane = lanes.find((l) => l.id === "e1")!;
    expect(lane.cards.map((c) => c.id)).toEqual(["s1"]);
    expect(lane.headerCard?.id).toBe("e1");
  });

  it("orders epic lanes alphabetically by title with orphan self-lanes last", () => {
    const epicB = card({ id: "eb", title: "Beta", type: "epic" });
    const epicA = card({ id: "ea", title: "Alpha", type: "epic" });
    const orphan = card({ id: "s1", title: "Orphan", parentCardId: null });
    const lanes = groupByEpic([orphan, epicB, epicA]);
    expect(lanes.map((l) => l.id)).toEqual(["ea", "eb", "s1"]);
  });

  it("does not emit the Uncategorized lane when there are no orphan stories", () => {
    const epicA = card({ id: "ea", title: "Alpha", type: "epic" });
    const s1 = card({ id: "s1", parentCardId: "ea" });
    const lanes = groupByEpic([epicA, s1]);
    expect(lanes.map((l) => l.id)).toEqual(["ea"]);
  });

  it("epic lanes and orphan self-lanes both use kind=epic", () => {
    const epicA = card({ id: "ea", title: "Alpha", type: "epic" });
    const orphan = card({ id: "s1", parentCardId: null });
    const lanes = groupByEpic([epicA, orphan]);
    expect(lanes.find((l) => l.id === "ea")?.kind).toBe("epic");
    // Orphans get their own lane now; same kind so renderer treats them
    // identically (single-row lane with header bar).
    expect(lanes.find((l) => l.id === "s1")?.kind).toBe("epic");
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

  it("skips epics and subtasks (epic mode renders them; assignee v1 ignores)", () => {
    const epic = card({ id: "e1", type: "epic" });
    const sub = card({ id: "s1", type: "subtask", parentCardId: "x" });
    const story = card({ id: "c1" });
    const members = [
      { cardId: "e1", userId: "u1" },
      { cardId: "s1", userId: "u1" },
      { cardId: "c1", userId: "u1" },
    ];
    const lanes = groupByAssignee([epic, sub, story], members, profiles);
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

  it("skips epics and subtasks (component v1 ignores them)", () => {
    const epic = card({ id: "e1", type: "epic" });
    const sub = card({ id: "s1", type: "subtask", parentCardId: "x" });
    const story = card({ id: "c1" });
    const cardComponents = [
      { cardId: "e1", componentId: "k1" },
      { cardId: "s1", componentId: "k1" },
      { cardId: "c1", componentId: "k1" },
    ];
    const lanes = groupByComponent([epic, sub, story], cardComponents, components);
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
