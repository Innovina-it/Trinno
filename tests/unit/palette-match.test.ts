import { describe, it, expect } from "vitest";
import { paletteScore, filterPalette } from "@/lib/palette-match";

describe("paletteScore", () => {
  it("returns 0 for empty query", () => {
    expect(paletteScore("Marketing", "")).toBe(0);
  });
  it("returns null when no match", () => {
    expect(paletteScore("Marketing", "zzz")).toBeNull();
  });
  it("returns 0 for prefix match", () => {
    expect(paletteScore("Marketing", "mark")).toBe(0);
  });
  it("returns the substring start index", () => {
    expect(paletteScore("Q1 Marketing Plan", "mark")).toBe(3);
  });
  it("is case-insensitive", () => {
    expect(paletteScore("MARKETING", "mark")).toBe(0);
  });
});

describe("filterPalette", () => {
  it("returns the items unchanged when query is empty", () => {
    const items = [{ label: "A" }, { label: "B" }];
    expect(filterPalette(items, "")).toEqual(items);
  });
  it("drops non-matching items", () => {
    const items = [
      { label: "Roadmap" },
      { label: "Backlog" },
      { label: "Releases" },
    ];
    expect(filterPalette(items, "back").map((x) => x.label)).toEqual([
      "Backlog",
    ]);
  });
  it("orders prefix matches before substring matches", () => {
    const items = [
      { label: "Q1 Marketing" },
      { label: "Marketing Plan" },
    ];
    expect(filterPalette(items, "mark").map((x) => x.label)).toEqual([
      "Marketing Plan",
      "Q1 Marketing",
    ]);
  });
  it("preserves declared order on ties", () => {
    const items = [
      { label: "Bugs" },
      { label: "Builds" },
      { label: "Buy list" },
    ];
    expect(filterPalette(items, "bu").map((x) => x.label)).toEqual([
      "Bugs",
      "Builds",
      "Buy list",
    ]);
  });
});
