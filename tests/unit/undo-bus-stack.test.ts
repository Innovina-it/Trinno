import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { undoBus } from "@/lib/undo-bus";

function pushN(n: number, opts?: { redo?: boolean; log?: string[] }) {
  for (let i = 1; i <= n; i++) {
    undoBus.push({
      message: `action ${i}`,
      undo: () => {
        opts?.log?.push(`undo ${i}`);
      },
      ...(opts?.redo
        ? {
            redo: () => {
              opts?.log?.push(`redo ${i}`);
            },
          }
        : {}),
    });
  }
}

describe("undo bus — bounded undo/redo stacks (Unit A1)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    undoBus._resetForTests();
  });
  afterEach(() => {
    undoBus._resetForTests();
    vi.useRealTimers();
  });

  it("accepts the legacy push shape ({message, undo}) unchanged", async () => {
    let undone = false;
    undoBus.push({ message: "legacy", undo: () => void (undone = true) });
    const r = await undoBus.undo();
    expect(r.ok).toBe(true);
    expect(r.entry?.message).toBe("legacy");
    expect(undone).toBe(true);
  });

  it("accumulates entries and undoes in LIFO order", async () => {
    const log: string[] = [];
    pushN(5, { log });
    expect(undoBus._stacksForTests().undo).toHaveLength(5);
    for (let i = 0; i < 5; i++) await undoBus.undo();
    expect(log).toEqual(["undo 5", "undo 4", "undo 3", "undo 2", "undo 1"]);
    const empty = await undoBus.undo();
    expect(empty.entry).toBeNull();
  });

  it("caps the undo stack at 50, dropping the oldest", () => {
    pushN(51);
    const { undo } = undoBus._stacksForTests();
    expect(undo).toHaveLength(50);
    expect(undo[0].message).toBe("action 2");
    expect(undo[49].message).toBe("action 51");
  });

  it("moves undone entries to the redo stack only when they carry redo()", async () => {
    undoBus.push({ message: "no-redo", undo: () => {} });
    undoBus.push({ message: "with-redo", undo: () => {}, redo: () => {} });
    await undoBus.undo(); // with-redo → redo stack
    await undoBus.undo(); // no-redo → dropped
    const { redo } = undoBus._stacksForTests();
    expect(redo.map((e) => e.message)).toEqual(["with-redo"]);
  });

  it("redo replays the callback and returns the entry to the undo stack", async () => {
    const log: string[] = [];
    pushN(1, { redo: true, log });
    await undoBus.undo();
    const r = await undoBus.redo();
    expect(r.ok).toBe(true);
    expect(log).toEqual(["undo 1", "redo 1"]);
    expect(undoBus._stacksForTests().undo).toHaveLength(1);
    expect(undoBus._stacksForTests().redo).toHaveLength(0);
    // and it can be undone again
    await undoBus.undo();
    expect(log).toEqual(["undo 1", "redo 1", "undo 1"]);
  });

  it("clears the redo stack on any new push", async () => {
    pushN(2, { redo: true });
    await undoBus.undo();
    expect(undoBus._stacksForTests().redo).toHaveLength(1);
    undoBus.push({ message: "new action", undo: () => {} });
    expect(undoBus._stacksForTests().redo).toHaveLength(0);
  });

  it("prunes entries older than 10 minutes from both stacks", async () => {
    pushN(2, { redo: true });
    await undoBus.undo(); // one on redo stack
    vi.advanceTimersByTime(10 * 60_000 + 1);
    undoBus.push({ message: "fresh", undo: () => {} });
    const { undo, redo } = undoBus._stacksForTests();
    expect(undo.map((e) => e.message)).toEqual(["fresh"]);
    expect(redo).toHaveLength(0);
  });

  it("banner auto-hide after 8s keeps the entry undoable", async () => {
    let undone = false;
    undoBus.push({ message: "kept", undo: () => void (undone = true) });
    expect(undoBus.snapshot()?.message).toBe("kept");
    vi.advanceTimersByTime(8_001);
    expect(undoBus.snapshot()).toBeNull(); // banner hidden
    expect(undoBus._stacksForTests().undo).toHaveLength(1);
    await undoBus.undo();
    expect(undone).toBe(true);
  });

  it("dismiss hides the banner but keeps the entry undoable", async () => {
    let undone = false;
    undoBus.push({ message: "dismissed", undo: () => void (undone = true) });
    undoBus.dismiss();
    expect(undoBus.snapshot()).toBeNull();
    expect(undoBus._stacksForTests().undo).toHaveLength(1);
    await undoBus.undo();
    expect(undone).toBe(true);
  });

  it("invoke() (banner button) undoes the newest entry", async () => {
    const log: string[] = [];
    pushN(2, { log });
    await undoBus.invoke();
    expect(log).toEqual(["undo 2"]);
    expect(undoBus._stacksForTests().undo).toHaveLength(1);
  });

  it("a failed undo is swallowed, reported not-ok, and not redoable", async () => {
    undoBus.push({
      message: "boom",
      undo: () => {
        throw new Error("network");
      },
      redo: () => {},
    });
    const r = await undoBus.undo();
    expect(r.ok).toBe(false);
    expect(r.entry?.message).toBe("boom");
    expect(undoBus._stacksForTests().redo).toHaveLength(0);
  });

  it("keeps the subscribe/listener contract: emits banner entry on push, null on hide", () => {
    const seen: (string | null)[] = [];
    const unsub = undoBus.subscribe((e) => seen.push(e?.message ?? null));
    undoBus.push({ message: "a", undo: () => {} });
    undoBus.dismiss();
    unsub();
    expect(seen).toEqual([null, "a", null]); // initial emit, push, dismiss
  });
});
