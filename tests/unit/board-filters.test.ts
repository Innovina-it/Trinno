import { describe, it, expect } from "vitest";
import {
  parseFilters,
  serializeFilters,
  applyFilters,
  partitionLanes,
} from "@/lib/board-filters";

const cards = [
  { id: "c1", title: "Bug fix", listId: "l1", boardId: "b", archived: false, type: "bug", parentCardId: null, dueDate: null, dueComplete: false, sprintId: null, position: "a" },
  { id: "c2", title: "Story",   listId: "l1", boardId: "b", archived: false, type: "story", parentCardId: null, dueDate: new Date(Date.now() - 86400000), dueComplete: false, sprintId: null, position: "b" },
  { id: "c3", title: "Task",    listId: "l2", boardId: "b", archived: false, type: "task", parentCardId: "c2", dueDate: null, dueComplete: false, sprintId: null, position: "c" },
];
const cardLabels = [
  { cardId: "c1", labelId: "lab1" },
  { cardId: "c3", labelId: "lab2" },
];
const cardMembers = [
  { cardId: "c1", userId: "u1" },
];

describe("parseFilters", () => {
  it("parses query params", () => {
    const f = parseFilters(new URLSearchParams("type=bug,task&label=lab1&due=overdue&assignee=me"));
    expect(f.types).toEqual(["bug", "task"]);
    expect(f.labelIds).toEqual(["lab1"]);
    expect(f.due).toBe("overdue");
    expect(f.assignedToMe).toBe(true);
  });

  it("handles empty", () => {
    const f = parseFilters(new URLSearchParams(""));
    expect(f.types).toEqual([]);
    expect(f.labelIds).toEqual([]);
    expect(f.due).toBeNull();
    expect(f.assignedToMe).toBe(false);
  });
});

describe("applyFilters", () => {
  it("filters by type", () => {
    const f = parseFilters(new URLSearchParams("type=bug"));
    const out = applyFilters(cards, { cardLabels, cardMembers, currentUserId: "u1" }, f);
    expect(out.map((c) => c.id)).toEqual(["c1"]);
  });

  it("filters by label intersection (AND across selected)", () => {
    const f = parseFilters(new URLSearchParams("label=lab2"));
    const out = applyFilters(cards, { cardLabels, cardMembers, currentUserId: "u1" }, f);
    expect(out.map((c) => c.id)).toEqual(["c3"]);
  });

  it("filters overdue", () => {
    const f = parseFilters(new URLSearchParams("due=overdue"));
    const out = applyFilters(cards, { cardLabels, cardMembers, currentUserId: "u1" }, f);
    expect(out.map((c) => c.id)).toEqual(["c2"]);
  });

  it("filters assigned-to-me", () => {
    const f = parseFilters(new URLSearchParams("assignee=me"));
    const out = applyFilters(cards, { cardLabels, cardMembers, currentUserId: "u1" }, f);
    expect(out.map((c) => c.id)).toEqual(["c1"]);
  });
});

describe("partitionLanes", () => {
  it("partitions by assignee", () => {
    const out = partitionLanes(cards, "assignee", { cardMembers, profiles: [{ id: "u1", displayName: "Alice" }] });
    expect(out.length).toBe(2); // u1 lane + unassigned lane
    const u1Lane = out.find((l) => l.key === "u1");
    expect(u1Lane?.cardIds).toEqual(["c1"]);
    const unassigned = out.find((l) => l.key === "");
    expect(unassigned?.cardIds.sort()).toEqual(["c2", "c3"]);
  });

  it("partitions by parent epic", () => {
    const out = partitionLanes(cards, "parent", {});
    const orphans = out.find((l) => l.key === "");
    expect(orphans?.cardIds.sort()).toEqual(["c1", "c2"]);
    const c2Children = out.find((l) => l.key === "c2");
    expect(c2Children?.cardIds).toEqual(["c3"]);
  });

  it("partitions by type in canonical order, omitting empty lanes", () => {
    const out = partitionLanes(cards, "type", {});
    // Order: epic, story, task, subtask, bug — only present types appear.
    expect(out.map((l) => l.key)).toEqual(["story", "task", "bug"]);
    expect(out.map((l) => l.label)).toEqual(["Story", "Task", "Bug"]);
    expect(out.find((l) => l.key === "story")?.cardIds).toEqual(["c2"]);
    expect(out.find((l) => l.key === "task")?.cardIds).toEqual(["c3"]);
    expect(out.find((l) => l.key === "bug")?.cardIds).toEqual(["c1"]);
  });
});

describe("hideCompleted filter", () => {
  const baseFilters: Omit<
    Parameters<typeof serializeFilters>[0],
    "hideCompleted"
  > = {
    types: [],
    labelIds: [],
    due: null,
    assignedToMe: false,
    unassigned: false,
    scheduled: false,
  };

  it("parses done=hide as hideCompleted: true", () => {
    const f = parseFilters(new URLSearchParams("done=hide"));
    expect(f.hideCompleted).toBe(true);
  });

  it("defaults hideCompleted to false when absent", () => {
    const f = parseFilters(new URLSearchParams(""));
    expect(f.hideCompleted).toBe(false);
  });

  it("serializes hideCompleted: true to done=hide", () => {
    const sp = serializeFilters({ ...baseFilters, hideCompleted: true });
    expect(sp.get("done")).toBe("hide");
  });

  it("omits the done key when hideCompleted is false", () => {
    const sp = serializeFilters({ ...baseFilters, hideCompleted: false });
    expect(sp.has("done")).toBe(false);
  });

  it("applyFilters with hideCompleted true drops cards with completedAt set", () => {
    const stub = [
      { id: "a", title: "A", archived: false, completedAt: null },
      { id: "b", title: "B", archived: false, completedAt: new Date() },
    ];
    const out = applyFilters(
      stub,
      { cardLabels: [], cardMembers: [], currentUserId: null },
      { ...baseFilters, hideCompleted: true },
    );
    expect(out.map((c) => c.id)).toEqual(["a"]);
  });

  it("applyFilters with hideCompleted false keeps both", () => {
    const stub = [
      { id: "a", title: "A", archived: false, completedAt: null },
      { id: "b", title: "B", archived: false, completedAt: new Date() },
    ];
    const out = applyFilters(
      stub,
      { cardLabels: [], cardMembers: [], currentUserId: null },
      { ...baseFilters, hideCompleted: false },
    );
    expect(out.map((c) => c.id)).toEqual(["a", "b"]);
  });
});
