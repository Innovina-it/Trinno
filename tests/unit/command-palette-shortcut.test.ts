import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("quick-add shortcut guard", () => {
  it("suppresses C when focus is inside editable controls", () => {
    const source = readFileSync(
      join(process.cwd(), "components/command-palette.tsx"),
      "utf8",
    );

    expect(source).toContain("isEditableShortcutTarget");
    expect(source).toContain("target.isContentEditable");
    expect(source).toContain('tag === "INPUT"');
    expect(source).toContain('tag === "TEXTAREA"');
    expect(source).toContain("shouldSuppressQuickAddShortcut(e, pathname)");
    expect(source).toContain("e.stopImmediatePropagation()");
  });
});
