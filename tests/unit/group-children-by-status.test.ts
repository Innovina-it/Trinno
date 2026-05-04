import { describe, it, expect } from "vitest";
import { groupChildrenByStatus } from "@/lib/epic/group-children-by-status";

const lists = [
  { id: "l-todo", statusKind: "todo" as const },
  { id: "l-prog", statusKind: "in_progress" as const },
  { id: "l-rev",  statusKind: "review" as const },
  { id: "l-done", statusKind: "done" as const },
  { id: "l-blk",  statusKind: "blocked" as const },
  { id: "l-orph", statusKind: null },
];

describe("groupChildrenByStatus", () => {
  it("returns 5 empty buckets + empty unmapped for empty children", () => {
    const r = groupChildrenByStatus([], lists);
    expect(r.todo).toEqual([]);
    expect(r.in_progress).toEqual([]);
    expect(r.review).toEqual([]);
    expect(r.done).toEqual([]);
    expect(r.blocked).toEqual([]);
    expect(r.unmapped).toEqual([]);
  });

  it("groups cards by their list's status_kind", () => {
    const cards = [
      { id: "c1", listId: "l-todo", position: "a0" },
      { id: "c2", listId: "l-prog", position: "a0" },
      { id: "c3", listId: "l-done", position: "a0" },
      { id: "c4", listId: "l-todo", position: "a1" },
    ];
    const r = groupChildrenByStatus(cards, lists);
    expect(r.todo.map((c) => c.id)).toEqual(["c1", "c4"]);
    expect(r.in_progress.map((c) => c.id)).toEqual(["c2"]);
    expect(r.done.map((c) => c.id)).toEqual(["c3"]);
    expect(r.unmapped).toEqual([]);
  });

  it("puts cards in unmapped when their list has no status_kind", () => {
    const cards = [{ id: "c1", listId: "l-orph", position: "a0" }];
    const r = groupChildrenByStatus(cards, lists);
    expect(r.unmapped.map((c) => c.id)).toEqual(["c1"]);
  });

  it("puts cards in unmapped when their list is missing from the lookup (CDC race)", () => {
    const cards = [{ id: "c1", listId: "missing", position: "a0" }];
    const r = groupChildrenByStatus(cards, lists);
    expect(r.unmapped.map((c) => c.id)).toEqual(["c1"]);
  });

  it("sorts each bucket by `position` ascending (string compare)", () => {
    const cards = [
      { id: "c2", listId: "l-todo", position: "a2" },
      { id: "c1", listId: "l-todo", position: "a0" },
      { id: "c3", listId: "l-todo", position: "a1" },
    ];
    const r = groupChildrenByStatus(cards, lists);
    expect(r.todo.map((c) => c.id)).toEqual(["c1", "c3", "c2"]);
  });
});
