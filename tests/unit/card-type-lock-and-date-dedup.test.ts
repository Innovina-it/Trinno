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

  it("type picker offers task+bug and is editable after creation", () => {
    const typePicker = source("components/board/card/type-picker.tsx");

    // Selectable types after the retire pass are task + bug only.
    expect(typePicker).toContain('type EditableType = "task" | "bug";');
    expect(typePicker).toContain('{ id: "task", label: "Task"');
    expect(typePicker).toContain('{ id: "bug",  label: "Bug"');

    // Legacy types render display-only (chip), never offered in the picker.
    expect(typePicker).toContain("const LEGACY_TYPES");
    expect(typePicker).toContain('story:             { label: "Story" }');
    expect(typePicker).toContain('subtask:           { label: "Subtask"');
    expect(typePicker).toContain('"legacy-subboard": { label: "Sub-board"');

    // Editable affordance for non-guests: trigger + per-type options. The
    // old creation-time lock is gone by design (type has no structural
    // meaning after epic retirement).
    expect(typePicker).toContain("const editable = !!cardId && !isGuest;");
    expect(typePicker).toContain('data-testid="card-type-edit"');
    expect(typePicker).toContain("data-testid={`card-type-option-${opt.id}`}");
    expect(typePicker).not.toContain('data-testid="card-type-locked"');
    expect(typePicker).not.toContain("Type is fixed at creation");

    // Guests get the read-only display chip.
    expect(typePicker).toContain('data-testid="card-type-display"');
  });
});
