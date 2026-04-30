import { describe, it, expect } from "vitest";
import {
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
  it("creates one lane per epic + Uncategorized for orphan stories", () => {
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
    expect(
      lanes.find((l) => l.id === "uncategorized")?.cards.map((c) => c.id),
    ).toEqual(["s2"]);
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

  it("orders epic lanes alphabetically by title with Uncategorized last", () => {
    const epicB = card({ id: "eb", title: "Beta", type: "epic" });
    const epicA = card({ id: "ea", title: "Alpha", type: "epic" });
    const orphan = card({ id: "s1", parentCardId: null });
    const lanes = groupByEpic([orphan, epicB, epicA]);
    expect(lanes.map((l) => l.id)).toEqual(["ea", "eb", "uncategorized"]);
  });

  it("does not emit the Uncategorized lane when there are no orphan stories", () => {
    const epicA = card({ id: "ea", title: "Alpha", type: "epic" });
    const s1 = card({ id: "s1", parentCardId: "ea" });
    const lanes = groupByEpic([epicA, s1]);
    expect(lanes.map((l) => l.id)).toEqual(["ea"]);
  });

  it("epic lanes have kind=epic and uncategorized has kind=uncategorized", () => {
    const epicA = card({ id: "ea", title: "Alpha", type: "epic" });
    const orphan = card({ id: "s1", parentCardId: null });
    const lanes = groupByEpic([epicA, orphan]);
    expect(lanes.find((l) => l.id === "ea")?.kind).toBe("epic");
    expect(lanes.find((l) => l.id === "uncategorized")?.kind).toBe(
      "uncategorized",
    );
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
