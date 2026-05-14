import { describe, expect, it } from "vitest";

type BoardRow = {
  id: string;
  title: string;
  parentBoardId: string | null;
  migratedFromEpicId: string | null;
};

type CardRow = {
  id: string;
  title: string;
  type: "epic" | "story" | "task" | "subtask" | "bug";
  boardId: string;
  parentCardId: string | null;
};

function childrenOfBoard(boards: BoardRow[], parentBoardId: string) {
  return boards.filter((board) => board.parentBoardId === parentBoardId);
}

function migrateEpicsToSubboards(
  boards: BoardRow[],
  cards: CardRow[],
): { boards: BoardRow[]; cards: CardRow[] } {
  const nextBoards = boards.map((board) => ({ ...board }));
  const nextCards = cards.map((card) => ({ ...card }));
  const byParent = new Map<string, CardRow[]>();

  for (const card of nextCards) {
    if (!card.parentCardId) continue;
    byParent.set(card.parentCardId, [
      ...(byParent.get(card.parentCardId) ?? []),
      card,
    ]);
  }

  for (const epic of nextCards.filter((card) => card.type === "epic")) {
    const subBoardId = `sub-${epic.id}`;
    nextBoards.push({
      id: subBoardId,
      title: epic.title,
      parentBoardId: epic.boardId,
      migratedFromEpicId: epic.id,
    });

    const stack = (byParent.get(epic.id) ?? []).map((card) => ({
      card,
      depth: 1,
    }));
    while (stack.length > 0) {
      const current = stack.shift()!;
      current.card.boardId = subBoardId;
      if (current.depth === 1) current.card.parentCardId = null;
      for (const child of byParent.get(current.card.id) ?? []) {
        stack.push({ card: child, depth: current.depth + 1 });
      }
    }
  }

  return { boards: nextBoards, cards: nextCards };
}

function rollbackEpicSubboardMigration(
  boards: BoardRow[],
  cards: CardRow[],
): { boards: BoardRow[]; cards: CardRow[] } {
  const subboards = boards.filter((board) => board.migratedFromEpicId);
  const nextCards = cards.map((card) => ({ ...card }));
  const nextBoards = boards
    .filter((board) => !board.migratedFromEpicId)
    .map((board) => ({ ...board }));

  for (const subboard of subboards) {
    const epic = nextCards.find(
      (card) => card.id === subboard.migratedFromEpicId,
    );
    if (!epic || !subboard.parentBoardId) continue;

    const moved = nextCards.filter((card) => card.boardId === subboard.id);
    for (const card of moved) {
      card.boardId = subboard.parentBoardId;
    }
    for (const card of moved.filter((card) => card.parentCardId === null)) {
      card.parentCardId = epic.id;
    }
  }

  return { boards: nextBoards, cards: nextCards };
}

describe("sub-board migration model", () => {
  it("finds child boards by parent_board_id", () => {
    const setup = {
      boards: [
        {
          id: "board-parent",
          title: "Parent",
          parentBoardId: null,
          migratedFromEpicId: null,
        },
        {
          id: "board-child",
          title: "Child",
          parentBoardId: "board-parent",
          migratedFromEpicId: null,
        },
      ],
    };

    const actual = childrenOfBoard(setup.boards, "board-parent");

    expect(actual.map((board) => board.id)).toEqual(["board-child"]);
  });

  it("migrates epic cards into sub-boards and reparents direct children", () => {
    const setup = {
      boards: [
        {
          id: "board-1",
          title: "Parent",
          parentBoardId: null,
          migratedFromEpicId: null,
        },
      ],
      cards: [
        {
          id: "epic-1",
          title: "Epic A",
          type: "epic",
          boardId: "board-1",
          parentCardId: null,
        },
        {
          id: "epic-2",
          title: "Epic B",
          type: "epic",
          boardId: "board-1",
          parentCardId: null,
        },
        {
          id: "story-1",
          title: "Story",
          type: "story",
          boardId: "board-1",
          parentCardId: "epic-1",
        },
        {
          id: "task-1",
          title: "Task",
          type: "task",
          boardId: "board-1",
          parentCardId: "epic-2",
        },
        {
          id: "subtask-1",
          title: "Subtask",
          type: "subtask",
          boardId: "board-1",
          parentCardId: "story-1",
        },
      ] satisfies CardRow[],
    };

    const actual = migrateEpicsToSubboards(setup.boards, setup.cards);

    expect(actual.boards.filter((board) => board.parentBoardId === "board-1"))
      .toHaveLength(2);
    expect(
      actual.boards.map((board) => board.migratedFromEpicId).filter(Boolean),
    ).toEqual(["epic-1", "epic-2"]);
    expect(actual.cards.find((card) => card.id === "story-1")).toMatchObject({
      boardId: "sub-epic-1",
      parentCardId: null,
    });
    expect(actual.cards.find((card) => card.id === "subtask-1")).toMatchObject({
      boardId: "sub-epic-1",
      parentCardId: "story-1",
    });
  });

  it("rolls migrated cards back to epic parents and handles empty epics", () => {
    const setup = {
      boards: [
        {
          id: "board-1",
          title: "Parent",
          parentBoardId: null,
          migratedFromEpicId: null,
        },
      ],
      cards: [
        {
          id: "epic-1",
          title: "Epic A",
          type: "epic",
          boardId: "board-1",
          parentCardId: null,
        },
        {
          id: "epic-empty",
          title: "Empty Epic",
          type: "epic",
          boardId: "board-1",
          parentCardId: null,
        },
        {
          id: "story-1",
          title: "Story",
          type: "story",
          boardId: "board-1",
          parentCardId: "epic-1",
        },
      ] satisfies CardRow[],
    };

    const migrated = migrateEpicsToSubboards(setup.boards, setup.cards);
    const actual = rollbackEpicSubboardMigration(
      migrated.boards,
      migrated.cards,
    );

    expect(actual.boards).toEqual(setup.boards);
    expect(actual.cards.find((card) => card.id === "epic-1")).toMatchObject({
      id: "epic-1",
      title: "Epic A",
    });
    expect(actual.cards.find((card) => card.id === "story-1")).toMatchObject({
      boardId: "board-1",
      parentCardId: "epic-1",
    });
    expect(actual.cards).not.toContainEqual(
      expect.objectContaining({ boardId: "sub-epic-empty" }),
    );
  });
});
