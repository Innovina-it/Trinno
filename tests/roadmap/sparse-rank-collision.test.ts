import { describe, expect, it } from "vitest";
import {
  RANK_STEP,
  computeOptimisticRank,
  computeNewRank,
} from "@/lib/roadmap/sparse-rank";

describe("roadmap sparse rank collision handling", () => {
  it("keeps adversarial local reorders distinct when they target the same gap", () => {
    const first = computeNewRank(0, RANK_STEP * 2);
    const second = computeOptimisticRank(0, RANK_STEP * 2, [first]);

    expect(first).toBe(RANK_STEP);
    expect(second).not.toBe(first);
    expect(second).toBeGreaterThan(0);
    expect(second).toBeLessThan(RANK_STEP * 2);
  });
});
