import { describe, it, expect } from "vitest";
import { mapWithConcurrency } from "@/lib/concurrency";

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("mapWithConcurrency", () => {
  it("preserves input order in the results", async () => {
    // Reverse-staggered delays: later items resolve first, so any
    // completion-order bug would scramble the output.
    const items = [30, 20, 10, 0];
    const out = await mapWithConcurrency(
      items,
      2,
      (ms, i) => new Promise<number>((r) => setTimeout(() => r(i), ms)),
    );
    expect(out).toEqual([0, 1, 2, 3]);
  });

  it("never exceeds the in-flight limit", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 12 }, (_, i) => i), 3, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await tick();
      await tick();
      inFlight -= 1;
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1); // sanity: it did actually parallelize
  });

  it("propagates a rejection like Promise.all", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
  });

  it("handles empty input and limit larger than the list", async () => {
    expect(await mapWithConcurrency([], 4, async (x) => x)).toEqual([]);
    expect(await mapWithConcurrency([7], 100, async (x) => x * 2)).toEqual([14]);
  });
});
