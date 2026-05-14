import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("sub-board UI migration contracts", () => {
  it("keeps the new-card type picker to Story, Task, Subtask, and Bug", () => {
    const dialog = source("components/board/new-card-dialog.tsx");

    expect(dialog).toContain('value: "story", label: "Story"');
    expect(dialog).toContain('value: "task", label: "Task"');
    expect(dialog).toContain('value: "subtask", label: "Subtask"');
    expect(dialog).toContain('value: "bug", label: "Bug"');
    expect(dialog).not.toMatch(/label:\s*"Epic"/);
    expect(dialog).not.toMatch(/value:\s*"epic"/);
  });

  it("routes a stored epic type through the legacy sub-board display path", () => {
    const quickView = source("components/board/card-quick-view.tsx");
    const typePicker = source("components/board/card/type-picker.tsx");

    expect(quickView).toContain('label: "Sub-board"');
    expect(quickView).toContain(": [{ ...LEGACY_SUBBOARD_OPTION, value: cardType }, ...TYPE_OPTIONS]");
    expect(typePicker).toContain('label: "Sub-board"');
    expect(typePicker).toContain("?? LEGACY_SUBBOARD_TYPE");
  });

  it("rejects edit-mode type mutation with a user-visible error", () => {
    const typePicker = source("components/board/card/type-picker.tsx");

    expect(typePicker).toContain('toast.error("Type is fixed at creation")');
    expect(typePicker).toContain("onClick={rejectTypeChange}");
    expect(typePicker).toContain('data-testid="card-type-locked"');
  });
});
