import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

// Post-epic-retirement contract (migrations 0099/0100/0105/0106 + the
// 2026-05-18 retire pass). `cards.type` is a cosmetic label:
//   - selectable values: task, bug
//   - legacy display-only: story, subtask, legacy-subboard
//   - "sub-board" is a relationship (boards.parent_card_id), not a type
// Type is editable after creation for non-guests (the old creation-time
// lock is gone). These are source-text contract tests because vitest can't
// render @base-ui components — they guard the literal symbols in source.
describe("sub-board UI migration contracts", () => {
  it("limits the new-card type picker to Task, Bug, and the UX-only Sub-board (no Epic/Story/Subtask)", () => {
    const dialog = source("components/board/new-card-dialog.tsx");

    // Selectable creation types are task + bug. Sub-board is a UX-only
    // option that creates a task and promotes it (never written to type).
    expect(dialog).toContain('type CardType = "task" | "bug" | "sub-board";');
    expect(dialog).toContain('value: "task", label: "Task"');
    expect(dialog).toContain('value: "bug", label: "Bug"');
    expect(dialog).toContain('value: "sub-board", label: "Sub-board"');

    // Epic / Story / Subtask are NOT selectable creation types anymore.
    expect(dialog).not.toMatch(/value:\s*"epic"/);
    expect(dialog).not.toMatch(/label:\s*"Epic"/);
    expect(dialog).not.toMatch(/value:\s*"story"/);
    expect(dialog).not.toMatch(/value:\s*"subtask"/);
  });

  it("routes a stored legacy type (e.g. legacy-subboard) through the legacy display path", () => {
    const quickView = source("components/board/card-quick-view.tsx");
    const typePicker = source("components/board/card/type-picker.tsx");

    // card-quick-view: a stored type not in TYPE_OPTIONS gets a display-only
    // legacy entry prepended via the LEGACY_SUBBOARD_OPTION fallback.
    expect(quickView).toContain('label: "Sub-board"');
    expect(quickView).toContain("{ ...LEGACY_SUBBOARD_OPTION, value: cardType }");
    expect(quickView).toContain("const cardType = card.type ?? \"task\";");

    // type-picker: LEGACY_TYPES map carries the display-only legacy labels;
    // "legacy-subboard" → "Sub-board". Unknown types fall back to it.
    expect(typePicker).toContain('"legacy-subboard": { label: "Sub-board"');
    expect(typePicker).toContain("LEGACY_TYPES[type]");
  });

  it("exposes an editable type affordance (NOT the old creation-time lock)", () => {
    const typePicker = source("components/board/card/type-picker.tsx");

    // The picker is editable for non-guests: a trigger plus per-type options.
    expect(typePicker).toContain('data-testid="card-type-edit"');
    expect(typePicker).toContain("data-testid={`card-type-option-${opt.id}`}");
    expect(typePicker).toContain("const editable = !!cardId && !isGuest;");
    // Guests get a read-only chip instead.
    expect(typePicker).toContain('data-testid="card-type-display"');

    // The old lock contract is gone by design.
    expect(typePicker).not.toContain('data-testid="card-type-locked"');
    expect(typePicker).not.toContain("rejectTypeChange");
    expect(typePicker).not.toContain("Type is fixed at creation");
  });
});
