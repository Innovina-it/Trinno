import { describe, it, expect } from "vitest";

// U5 (revision delta) — the dependency-free line diff that turns "old revision
// text vs current text" into the VERIFIED CHANGES block fed to the recap.
import { diffLines } from "@/lib/pma/text-diff";

describe("diffLines", () => {
  it("identical texts → zero counts, empty text", () => {
    const d = diffLines("a\nb\nc", "a\nb\nc");
    expect(d).toEqual({ added: 0, removed: 0, text: "", truncated: false });
  });

  it("reports added and removed lines with context", () => {
    const oldT = ["title", "intro", "budget: 10k", "end"].join("\n");
    const newT = ["title", "intro", "budget: 40k", "timeline: Q3", "end"].join("\n");
    const d = diffLines(oldT, newT);
    expect(d.added).toBe(2); // new budget line + timeline
    expect(d.removed).toBe(1); // old budget line
    expect(d.text).toContain("- budget: 10k");
    expect(d.text).toContain("+ budget: 40k");
    expect(d.text).toContain("+ timeline: Q3");
    expect(d.text).toContain("  intro"); // context line preserved
    expect(d.truncated).toBe(false);
  });

  it("normalizes CRLF (Docs exports carry \\r\\n)", () => {
    const d = diffLines("a\r\nb", "a\nb");
    expect(d.added + d.removed).toBe(0);
  });

  it("elides long unchanged stretches", () => {
    const common = Array.from({ length: 50 }, (_, i) => `line ${i}`);
    const oldT = [...common, "old tail"].join("\n");
    const newT = [...common, "new tail"].join("\n");
    const d = diffLines(oldT, newT);
    expect(d.text).toContain("[…]"); // the 50 common lines are elided
    expect(d.text).toContain("- old tail");
    expect(d.text).toContain("+ new tail");
  });

  it("truncates the rendered diff at maxChars", () => {
    const oldT = "same";
    const newT = ["same", ...Array.from({ length: 500 }, (_, i) => `added line ${i} with some padding text`)].join("\n");
    const d = diffLines(oldT, newT, 500);
    expect(d.truncated).toBe(true);
    expect(d.text.length).toBeLessThan(600);
    expect(d.added).toBe(500); // counts stay exact even when text truncates
  });

  it("degrades to a grounded summary when the DP would be too large", () => {
    // two mostly-disjoint 2100-line bodies → 2100×2100 > 4M cells
    const oldT = Array.from({ length: 2100 }, (_, i) => `old ${i} x`).join("\n");
    const newT = Array.from({ length: 2100 }, (_, i) => `new ${i} y`).join("\n");
    const d = diffLines(oldT, newT);
    expect(d.truncated).toBe(true);
    expect(d.text).toContain("diff too large");
    expect(d.added).toBe(2100);
    expect(d.removed).toBe(2100);
  });
});
