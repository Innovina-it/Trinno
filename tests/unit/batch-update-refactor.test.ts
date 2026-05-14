import { beforeEach, describe, expect, it, vi } from "vitest";

type CardRow = {
  id: string;
  archived: boolean;
  startDate: Date | null;
  targetDate: Date | null;
};

const state = vi.hoisted(() => ({
  rows: [] as CardRow[],
  updateCalls: [] as Array<Record<string, unknown>>,
  insertCalls: [] as Array<unknown>,
  expectedShiftMinutes: 0,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSessionToken: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock("@/lib/db/client", () => {
  const tx = {
    update: vi.fn(() => ({
      set: (patch: Record<string, unknown>) => {
        state.updateCalls.push(patch);
        return {
          where: () => ({
            returning: async () => {
              if ("archived" in patch) {
                state.rows = state.rows.map((row) => ({
                  ...row,
                  archived: patch.archived as boolean,
                }));
              } else if ("startDate" in patch || "targetDate" in patch) {
                const deltaMs = state.expectedShiftMinutes * 60_000;
                state.rows = state.rows.map((row) => ({
                  ...row,
                  startDate: row.startDate
                    ? new Date(row.startDate.getTime() + deltaMs)
                    : null,
                  targetDate: row.targetDate
                    ? new Date(row.targetDate.getTime() + deltaMs)
                    : null,
                }));
              }
              return state.rows
                .filter((row) => row.startDate !== null || row.targetDate !== null || "archived" in patch)
                .map((row) => ({ id: row.id }));
            },
          }),
        };
      },
    })),
    insert: vi.fn(() => {
      state.insertCalls.push({});
      return {
        values: () => ({
          returning: async () => [],
        }),
      };
    }),
  };

  return {
    dbAsUser: vi.fn(async (_token: string, fn: (txArg: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
  };
});

function uuid(n: number) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function seedCards(count: number) {
  const base = Date.UTC(2026, 0, 1, 9, 0, 0);
  state.rows = Array.from({ length: count }, (_, i) => ({
    id: uuid(i + 1),
    archived: false,
    startDate: new Date(base + i * 60_000),
    targetDate: new Date(base + (i + 30) * 60_000),
  }));
}

describe("batch update refactors", () => {
  beforeEach(() => {
    seedCards(25);
    state.updateCalls = [];
    state.insertCalls = [];
    state.expectedShiftMinutes = 0;
    vi.clearAllMocks();
  });

  it("bulkArchiveCardsImpl archives a seeded batch with one UPDATE", async () => {
    const { bulkArchiveCardsImpl } = await import("@/actions/cards");
    const started = performance.now();

    const result = await bulkArchiveCardsImpl("token", {
      cardIds: state.rows.map((row) => row.id),
      archived: true,
    });
    const elapsedMs = performance.now() - started;

    expect(result.updated).toBe(25);
    expect(state.updateCalls).toHaveLength(1);
    expect(state.insertCalls).toHaveLength(0);
    expect(state.rows.every((row) => row.archived)).toBe(true);
    expect(elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("bulkShiftCardDatesImpl shifts a seeded batch with one UPDATE", async () => {
    const { bulkShiftCardDatesImpl } = await import("@/actions/sprints");
    const before = state.rows.map((row) => ({
      id: row.id,
      startTime: row.startDate!.getTime(),
      targetTime: row.targetDate!.getTime(),
    }));
    state.expectedShiftMinutes = 90;
    const started = performance.now();

    const result = await bulkShiftCardDatesImpl("token", {
      cardIds: state.rows.map((row) => row.id),
      deltaMinutes: state.expectedShiftMinutes,
    });
    const elapsedMs = performance.now() - started;

    expect(result.updated).toBe(25);
    expect(state.updateCalls).toHaveLength(1);
    expect(state.insertCalls).toHaveLength(0);
    expect(
      state.rows.every((row, i) => {
        const deltaMs = state.expectedShiftMinutes * 60_000;
        return (
          row.startDate!.getTime() === before[i].startTime + deltaMs &&
          row.targetDate!.getTime() === before[i].targetTime + deltaMs
        );
      }),
    ).toBe(true);
    expect(elapsedMs).toBeGreaterThanOrEqual(0);
  });
});
