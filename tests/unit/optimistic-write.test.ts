import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { toast } from "sonner";
import { optimisticWrite } from "@/lib/optimistic-write";
import { undoBus } from "@/lib/undo-bus";

describe("optimisticWrite (instant-feedback Unit A1)", () => {
  beforeEach(() => {
    undoBus._resetForTests();
    vi.clearAllMocks();
  });

  it("applies locally BEFORE the server write resolves", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const p = optimisticWrite<number>({
      prev: 1,
      next: 2,
      apply: (v) => order.push(`apply ${v}`),
      write: async () => {
        order.push("write start");
        await gate;
      },
      message: "n updated",
    });
    expect(order).toEqual(["apply 2", "write start"]);
    release();
    await p;
  });

  it("rolls back, toasts and rethrows when the write fails — no undo entry", async () => {
    const applied: number[] = [];
    await expect(
      optimisticWrite<number>({
        prev: 1,
        next: 2,
        apply: (v) => applied.push(v),
        write: () => Promise.reject(new Error("boom")),
        message: "n updated",
      }),
    ).rejects.toThrow("boom");
    expect(applied).toEqual([2, 1]);
    expect(toast.error).toHaveBeenCalledWith("boom");
    expect(undoBus._stacksForTests().undo).toHaveLength(0);
  });

  it("pushes an undo entry whose undo/redo replay apply+write with swapped values", async () => {
    const applied: number[] = [];
    const writes: number[] = [];
    await optimisticWrite<number>({
      prev: 1,
      next: 2,
      apply: (v) => applied.push(v),
      write: async (v) => void writes.push(v),
      message: "n updated",
    });
    expect(undoBus._stacksForTests().undo.map((e) => e.message)).toEqual([
      "n updated",
    ]);
    await undoBus.undo();
    expect(applied).toEqual([2, 1]);
    expect(writes).toEqual([2, 1]);
    await undoBus.redo();
    expect(applied).toEqual([2, 1, 2]);
    expect(writes).toEqual([2, 1, 2]);
  });

  it("a failed undo rolls back, names the entry in the toast, and stays off the redo stack", async () => {
    let fail = false;
    const applied: number[] = [];
    await optimisticWrite<number>({
      prev: 1,
      next: 2,
      apply: (v) => applied.push(v),
      write: () => (fail ? Promise.reject(new Error("net")) : Promise.resolve()),
      message: "n updated",
    });
    fail = true;
    const r = await undoBus.undo();
    expect(r.ok).toBe(false);
    expect(applied).toEqual([2, 1, 2]); // apply prev, then rollback to next
    expect(toast.error).toHaveBeenCalledWith("Undo failed — n updated: net");
    expect(undoBus._stacksForTests().redo).toHaveLength(0);
  });
});
