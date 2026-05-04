import { describe, it, expect } from "vitest";
import {
  AGGREGATE_COLUMNS,
  groupByStatus,
  findTargetListId,
  cardMatchesFilter,
  type AggregateColumnId,
} from "@/lib/aggregate-kanban/group";

type Card = {
  id: string;
  boardId: string;
  listId: string;
  archived: boolean;
};
type List = {
  id: string;
  boardId: string;
  position?: string;
  statusKind:
    | "todo"
    | "in_progress"
    | "review"
    | "done"
    | "blocked"
    | null;
};

describe("AGGREGATE_COLUMNS", () => {
  it("orders columns todo → in_progress → review → done → blocked → unmapped", () => {
    expect(AGGREGATE_COLUMNS.map((c) => c.id)).toEqual([
      "todo",
      "in_progress",
      "review",
      "done",
      "blocked",
      "unmapped",
    ] as AggregateColumnId[]);
  });
});

describe("groupByStatus", () => {
  const lists: List[] = [
    { id: "l1", boardId: "b1", statusKind: "todo" },
    { id: "l2", boardId: "b1", statusKind: "in_progress" },
    { id: "l3", boardId: "b2", statusKind: "todo" },
    { id: "l4", boardId: "b2", statusKind: null },
  ];

  it("groups cards by their list's statusKind", () => {
    const cards: Card[] = [
      { id: "c1", boardId: "b1", listId: "l1", archived: false },
      { id: "c2", boardId: "b1", listId: "l2", archived: false },
      { id: "c3", boardId: "b2", listId: "l3", archived: false },
    ];
    const result = groupByStatus(cards, lists);
    expect(result.todo.map((c) => c.id)).toEqual(["c1", "c3"]);
    expect(result.in_progress.map((c) => c.id)).toEqual(["c2"]);
    expect(result.review).toEqual([]);
    expect(result.unmapped).toEqual([]);
  });

  it("routes cards on unmapped lists to the 'unmapped' bucket", () => {
    const cards: Card[] = [
      { id: "c4", boardId: "b2", listId: "l4", archived: false },
    ];
    expect(groupByStatus(cards, lists).unmapped.map((c) => c.id)).toEqual([
      "c4",
    ]);
  });

  it("excludes archived cards", () => {
    const cards: Card[] = [
      { id: "c5", boardId: "b1", listId: "l1", archived: true },
    ];
    expect(groupByStatus(cards, lists).todo).toEqual([]);
  });

  it("excludes cards whose list isn't in the input (CDC race)", () => {
    const cards: Card[] = [
      { id: "c6", boardId: "b1", listId: "missing", archived: false },
    ];
    const result = groupByStatus(cards, lists);
    for (const col of AGGREGATE_COLUMNS) {
      expect(result[col.id].some((c) => c.id === "c6")).toBe(false);
    }
  });
});

describe("findTargetListId", () => {
  // `findTargetListId` walks `lists` in array order. Callers must sort by
  // list `position` ascending before passing in, so the helper picks the
  // visually-first list on the board with the target status — that's the
  // semantics the view layer relies on.
  const lists: List[] = [
    { id: "l1", boardId: "b1", position: "a0", statusKind: "todo" },
    { id: "l2", boardId: "b1", position: "a1", statusKind: "in_progress" },
    { id: "l3", boardId: "b1", position: "a2", statusKind: "in_progress" },
    { id: "l4", boardId: "b2", position: "a0", statusKind: "todo" },
  ];

  it("returns the first list on the board with the target statusKind", () => {
    expect(findTargetListId(lists, "b1", "in_progress")).toBe("l2");
  });

  it("returns null when no list on the board has the status", () => {
    expect(findTargetListId(lists, "b1", "blocked")).toBeNull();
  });

  it("ignores lists from other boards", () => {
    expect(findTargetListId(lists, "b2", "in_progress")).toBeNull();
  });

  it("returns null when target is 'unmapped' (no semantic target)", () => {
    expect(findTargetListId(lists, "b1", "unmapped")).toBeNull();
  });
});

describe("cardMatchesFilter", () => {
  type FilterCard = {
    id: string;
    title: string;
    priority: "p0" | "p1" | "p2" | "p3" | "p4" | null;
    sprintId: string | null;
    dueDate: Date | null;
  };
  type Member = { cardId: string; userId: string };

  const me = "user-1";
  const c1: FilterCard = {
    id: "c1",
    title: "Implement feature",
    priority: "p1",
    sprintId: "s1",
    dueDate: null,
  };
  const c2: FilterCard = {
    id: "c2",
    title: "Fix bug",
    priority: null,
    sprintId: null,
    dueDate: null,
  };
  const members: Member[] = [
    { cardId: "c1", userId: me },
  ];

  it("scope=mine includes assigned, excludes unassigned", () => {
    expect(
      cardMatchesFilter(c1, {
        scope: "mine",
        viewerId: me,
        members,
        query: "",
      }),
    ).toBe(true);
    expect(
      cardMatchesFilter(c2, {
        scope: "mine",
        viewerId: me,
        members,
        query: "",
      }),
    ).toBe(false);
  });

  it("scope=all includes both", () => {
    expect(
      cardMatchesFilter(c2, {
        scope: "all",
        viewerId: me,
        members,
        query: "",
      }),
    ).toBe(true);
  });

  it("query filters by title (case-insensitive substring)", () => {
    expect(
      cardMatchesFilter(c1, {
        scope: "all",
        viewerId: me,
        members,
        query: "feature",
      }),
    ).toBe(true);
    expect(
      cardMatchesFilter(c1, {
        scope: "all",
        viewerId: me,
        members,
        query: "FEATURE",
      }),
    ).toBe(true);
    expect(
      cardMatchesFilter(c1, {
        scope: "all",
        viewerId: me,
        members,
        query: "bug",
      }),
    ).toBe(false);
  });

  it("priority filter accepts subset", () => {
    expect(
      cardMatchesFilter(c1, {
        scope: "all",
        viewerId: me,
        members,
        query: "",
        priorities: ["p0", "p1"],
      }),
    ).toBe(true);
    expect(
      cardMatchesFilter(c1, {
        scope: "all",
        viewerId: me,
        members,
        query: "",
        priorities: ["p2"],
      }),
    ).toBe(false);
  });

  it("sprint filter matches single id", () => {
    expect(
      cardMatchesFilter(c1, {
        scope: "all",
        viewerId: me,
        members,
        query: "",
        sprintId: "s1",
      }),
    ).toBe(true);
    expect(
      cardMatchesFilter(c1, {
        scope: "all",
        viewerId: me,
        members,
        query: "",
        sprintId: "s2",
      }),
    ).toBe(false);
  });
});
