import { describe, it, expect } from "vitest";
import { LINK_COLORS, DEFAULT_LINK_COLOR } from "@/lib/links/colors";

describe("link colors", () => {
  it("has the five fixed colours in order", () => {
    expect(LINK_COLORS.map((c) => c.key)).toEqual([
      "giallo", "arancione", "blu", "rosso", "verde",
    ]);
  });
  it("default is the first (giallo) hex", () => {
    expect(DEFAULT_LINK_COLOR).toBe(LINK_COLORS[0].hex);
    expect(DEFAULT_LINK_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
