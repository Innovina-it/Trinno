import { describe, it, expect } from "vitest";
import { normalizeUrl } from "@/lib/links/normalize-url";

describe("normalizeUrl", () => {
  it("prepends https:// when no scheme", () => {
    expect(normalizeUrl("drive.google.com/x")).toBe("https://drive.google.com/x");
  });
  it("keeps http/https as-is", () => {
    expect(normalizeUrl("http://a.test")).toBe("http://a.test");
    expect(normalizeUrl("https://a.test")).toBe("https://a.test");
  });
  it("trims surrounding whitespace", () => {
    expect(normalizeUrl("  https://a.test  ")).toBe("https://a.test");
  });
  it("throws on empty", () => {
    expect(() => normalizeUrl("   ")).toThrow();
  });
  it("throws on unparseable", () => {
    expect(() => normalizeUrl("ht!tp://%%%")).toThrow();
  });
});
