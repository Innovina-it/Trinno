import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LIST_TEMPLATES } from "@/lib/board-templates";
import { positionsBetween } from "@/lib/ordering";

type InsertCall = {
  table: unknown;
  values: unknown;
};

const state = vi.hoisted(() => ({
  selectResponses: [] as unknown[][],
  insertCalls: [] as InsertCall[],
  boardRow: {
    id: "00000000-0000-4000-8000-000000000010",
    workspaceId: "00000000-0000-4000-8000-000000000011",
    title: "Board",
    backgroundKind: "color",
    backgroundValue: "#000000",
    createdBy: "00000000-0000-4000-8000-000000000001",
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSessionToken: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock("@/lib/db/client", () => {
  const takeSelectResponse = () => state.selectResponses.shift() ?? [];
  const makeSelectBuilder = () => {
    const builder = {
      from: () => builder,
      innerJoin: () => builder,
      where: () => builder,
      orderBy: () => builder,
      limit: () => builder,
      then: (
        resolve: (value: unknown[]) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => Promise.resolve(takeSelectResponse()).then(resolve, reject),
    };
    return builder;
  };

  const tx = {
    select: vi.fn(() => makeSelectBuilder()),
    insert: vi.fn((table: unknown) => ({
      values: (values: unknown) => {
        state.insertCalls.push({ table, values });
        return {
          returning: async () => {
            if (
              values &&
              typeof values === "object" &&
              "workspaceId" in values
            ) {
              return [state.boardRow];
            }
            if (values && typeof values === "object" && "listId" in values) {
              return [
                {
                  id: "00000000-0000-4000-8000-000000000020",
                  boardId: "00000000-0000-4000-8000-000000000010",
                  ...values,
                },
              ];
            }
            return [];
          },
        };
      },
    })),
  };

  return {
    dbAsUser: vi.fn(async (_token: string, fn: (txArg: typeof tx) => unknown) =>
      fn(tx),
    ),
  };
});

function jwtFor(sub: string) {
  const payload = Buffer.from(JSON.stringify({ sub }), "utf8").toString(
    "base64url",
  );
  return `header.${payload}.signature`;
}

function uuid(n: number) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

describe("default board lists and subtask owner defaults", () => {
  beforeEach(() => {
    state.selectResponses = [];
    state.insertCalls = [];
    vi.clearAllMocks();
  });

  it("createBoardImpl inserts the three default lists in one batch", async () => {
    const { createBoardImpl } = await import("@/actions/boards");
    state.selectResponses = [[{ role: "owner" }]];

    const board = await createBoardImpl(jwtFor(uuid(1)), {
      workspaceId: uuid(11),
      title: "Board",
      backgroundKind: "color",
      backgroundValue: "#000000",
    });

    const defaultListInsert = state.insertCalls.find((call) =>
      Array.isArray(call.values),
    );
    expect(board.id).toBe(state.boardRow.id);
    expect(defaultListInsert?.values).toEqual(
      expect.arrayContaining(
        DEFAULT_LIST_TEMPLATES.map((list) =>
          expect.objectContaining({
            boardId: state.boardRow.id,
            title: list.name,
          }),
        ),
      ),
    );
    expect(defaultListInsert?.values).toEqual(
      DEFAULT_LIST_TEMPLATES.map((list, position) => ({
        boardId: state.boardRow.id,
        title: list.name,
        position: positionsBetween(null, null, DEFAULT_LIST_TEMPLATES.length)[
          position
        ],
      })),
    );
    expect(defaultListInsert?.values).toHaveLength(3);
    expect(
      (defaultListInsert?.values as Array<{ title: string }>).map(
        (list) => list.title,
      ),
    ).toEqual(["Todo", "In Progress", "Done"]);
  });

  it("createCardImpl defaults a new subtask owner to the parent owner", async () => {
    const { createCardImpl } = await import("@/actions/cards");
    const parentOwnerId = uuid(2);
    state.selectResponses = [
      [],
      [{ startDate: null, targetDate: null, ownerId: parentOwnerId }],
      [],
    ];

    const subtask = await createCardImpl(jwtFor(uuid(1)), {
      listId: uuid(12),
      title: "Subtask",
      parentCardId: uuid(13),
    });

    const cardInsert = state.insertCalls.find(
      (call) =>
        call.values &&
        !Array.isArray(call.values) &&
        typeof call.values === "object" &&
        "parentCardId" in call.values,
    );
    expect(subtask.ownerId).toBe(parentOwnerId);
    expect(cardInsert?.values).toMatchObject({
      parentCardId: uuid(13),
      ownerId: parentOwnerId,
    });
  });
});
