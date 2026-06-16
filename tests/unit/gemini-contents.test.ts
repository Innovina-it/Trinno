import { describe, it, expect, vi } from "vitest";

// gemini.ts carries an `import "server-only"` guard; stub it so the pure
// buildContents helper can be imported in the node test env (repo convention).
vi.mock("server-only", () => ({}));

import { buildContents } from "@/lib/pma/clients/gemini";

describe("buildContents", () => {
  it("returns the bare prompt string when no files", () => {
    expect(buildContents("hello", undefined)).toBe("hello");
  });

  it("returns inlineData parts + text when files present", () => {
    const out = buildContents("extract", [
      { mimeType: "application/pdf", data: "QUJD" },
    ]);
    expect(out).toEqual([
      { inlineData: { mimeType: "application/pdf", data: "QUJD" } },
      { text: "extract" },
    ]);
  });
});
