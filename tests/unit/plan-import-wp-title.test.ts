import { describe, it, expect } from "vitest";
import { wpDisplayTitle } from "@/lib/plan-import/wp-title";

describe("wpDisplayTitle", () => {
  it("prefixes the code when the title lacks it", () => {
    expect(wpDisplayTitle("WP1", "Project Management")).toBe(
      "WP1 — Project Management",
    );
  });

  it("does not double-prefix when the title already starts with the code", () => {
    expect(wpDisplayTitle("WP1", "WP1 — Reqs")).toBe("WP1 — Reqs");
  });

  it("returns the bare title when the code is empty or whitespace", () => {
    expect(wpDisplayTitle("", "Project Management")).toBe("Project Management");
    expect(wpDisplayTitle("   ", "Project Management")).toBe(
      "Project Management",
    );
  });

  it("trims surrounding whitespace on both sides", () => {
    expect(wpDisplayTitle(" WP2 ", "  Build  ")).toBe("WP2 — Build");
  });

  it("matches the code only at a word boundary (WP1 vs WP10)", () => {
    expect(wpDisplayTitle("WP1", "WP10 — Other")).toBe("WP1 — WP10 — Other");
  });

  it("returns the code alone when the title is empty", () => {
    expect(wpDisplayTitle("WP1", "")).toBe("WP1");
  });
});
