import { describe, expect, it } from "vitest";
import { isClientStale } from "@/lib/version/skew";

describe("isClientStale", () => {
  it("is stale when the two deployment ids differ", () => {
    expect(isClientStale("dpl_old", "dpl_new")).toBe(true);
  });

  it("is not stale when the ids match", () => {
    expect(isClientStale("dpl_same", "dpl_same")).toBe(false);
  });

  it("never nags when the client's own id is unknown (local dev / env off)", () => {
    expect(isClientStale("", "dpl_new")).toBe(false);
    expect(isClientStale(undefined, "dpl_new")).toBe(false);
    expect(isClientStale(null, "dpl_new")).toBe(false);
  });

  it("never nags when the live id could not be fetched", () => {
    expect(isClientStale("dpl_old", "")).toBe(false);
    expect(isClientStale("dpl_old", undefined)).toBe(false);
    expect(isClientStale("dpl_old", null)).toBe(false);
  });
});
