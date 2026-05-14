import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("card type lock and new-card date dedup contracts", () => {
  it("keeps create mode to one end-of-task date field", () => {
    const dialog = source("components/board/new-card-dialog.tsx");

    expect(dialog).toContain('data-testid="roadmap-new-card-target"');
    expect(dialog).toContain('targetDate: targetISO');
    expect(dialog).not.toContain('data-testid="roadmap-new-card-due"');
    expect(dialog).not.toContain('data-testid="roadmap-new-card-due-date"');
    expect(dialog).not.toMatch(/\bdueDate\s*:/);
  });

  it("locks the edit-mode type chip for every current card type", () => {
    const typePicker = source("components/board/card/type-picker.tsx");

    expect(typePicker).toContain('{ id: "story"');
    expect(typePicker).toContain('{ id: "task"');
    expect(typePicker).toContain('{ id: "subtask"');
    expect(typePicker).toContain('{ id: "bug"');
    expect(typePicker).toContain('data-testid="card-type-locked"');
    expect(typePicker).toContain('title="Type is fixed at creation"');
    expect(typePicker).toContain('aria-disabled="true"');
    expect(typePicker).toContain("pointer-events-none");
    expect(typePicker).toContain("disabled");
  });
});
