import { describe, it, expect } from "vitest";
import {
  computeNewRank,
  RANK_STEP,
  RankCollisionError,
} from "@/lib/roadmap/sparse-rank";

describe("computeNewRank", () => {
  it("returns RANK_STEP when both neighbours are null (first card)", () => {
    expect(computeNewRank(null, null)).toBe(RANK_STEP);
  });

  it("returns afterRank - RANK_STEP when dropping at top", () => {
    expect(computeNewRank(null, 5000)).toBe(5000 - RANK_STEP);
  });

  it("returns beforeRank + RANK_STEP when dropping at bottom", () => {
    expect(computeNewRank(2000, null)).toBe(2000 + RANK_STEP);
  });

  it("returns the integer midpoint when both ranks are set", () => {
    expect(computeNewRank(1000, 3000)).toBe(2000);
    expect(computeNewRank(1000, 2001)).toBe(1500);
  });

  it("throws RankCollisionError when neighbours are adjacent", () => {
    expect(() => computeNewRank(1000, 1001)).toThrow(RankCollisionError);
  });

  it("throws RankCollisionError when neighbours are equal", () => {
    expect(() => computeNewRank(1000, 1000)).toThrow(RankCollisionError);
  });
});
