import { describe, it, expect } from "vitest";

// U6c — the hang guard: a silent HTTP call becomes a per-file error instead of
// freezing the run until the stale-heartbeat reaper kills it.
import { withTimeout } from "@/lib/pma/with-timeout";

describe("withTimeout", () => {
  it("passes through a resolving promise", async () => {
    await expect(withTimeout(Promise.resolve(42), 1000, "op")).resolves.toBe(42);
  });

  it("passes through a rejecting promise", async () => {
    await expect(
      withTimeout(Promise.reject(new Error("boom")), 1000, "op"),
    ).rejects.toThrow("boom");
  });

  it("rejects with a labeled error when the promise hangs", async () => {
    const hang = new Promise<never>(() => {});
    await expect(withTimeout(hang, 20, 'recap generation for "D1.1"')).rejects.toThrow(
      'recap generation for "D1.1" timed out after 0s',
    );
  });
});
