import { describe, it, expect } from "vitest";
import { positionBetween, positionsBetween } from "@/lib/ordering";

describe("positionBetween", () => {
  it("returns a key strictly between prev and next", () => {
    const k = positionBetween("a0", "a1");
    expect(k > "a0" && k < "a1").toBe(true);
  });

  it("returns a key after prev when next is null", () => {
    const k = positionBetween("a0", null);
    expect(k > "a0").toBe(true);
  });

  it("returns a key before next when prev is null", () => {
    const k = positionBetween(null, "a1");
    expect(k < "a1").toBe(true);
  });

  it("returns the first key when both null", () => {
    expect(positionBetween(null, null)).toBeTypeOf("string");
  });
});

describe("positionsBetween", () => {
  it("returns N evenly-spaced keys between prev and next", () => {
    const keys = positionsBetween(null, null, 3);
    expect(keys.length).toBe(3);
    expect(keys[0] < keys[1]).toBe(true);
    expect(keys[1] < keys[2]).toBe(true);
  });
});
