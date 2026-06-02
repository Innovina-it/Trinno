import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const quickView = readFileSync(
  "components/board/card-quick-view.tsx",
  "utf8",
);
const modal = readFileSync("components/board/card-modal.tsx", "utf8");
const historyQuery = readFileSync("lib/queries/use-card-history.ts", "utf8");
const flags = readFileSync("lib/feature-flags/index.ts", "utf8");

describe("dispatch 7 card modal and quick view fixes", () => {
  it("routes Task detail clicks to the card modal route without fall-through", () => {
    expect(quickView).toContain("function openAdvanced(e?: React.MouseEvent<HTMLButtonElement>)");
    expect(quickView).toContain("e?.preventDefault();");
    expect(quickView).toContain("e?.stopPropagation();");
    expect(quickView).toContain("router.push(`/b/${boardId}/c/${card.id}`, { scroll: false });");
  });

  it("uses the saved card type as the active type chip source", () => {
    // quick-view derives the active type from the saved card.type and marks
    // the matching chip with data-active.
    expect(quickView).toContain('const cardType = card.type ?? "task";');
    expect(quickView).toContain('"data-active": selected ? "true" : "false"');
    // card-modal prefers the live store row, falling back to the SSR prop.
    expect(modal).toContain('const activeCardType = liveCard?.type ?? card.type ?? "task";');
    expect(modal).toContain("type={activeCardType}");
  });

  it("renders concrete subtask rows with titles and status instead of only a count", () => {
    expect(quickView).toContain('data-testid="card-quick-view-subtask-row"');
    expect(quickView).toContain("{subtask.title}");
    expect(quickView).toContain('{done ? "DONE" : "OPEN"}');
    expect(quickView).not.toContain("{subtaskDone}/{subtaskTotal}");
  });

  it("gates lazy card history behind the lazy_card_history flag", () => {
    expect(flags).toContain('"lazy_card_history"');
    expect(historyQuery).toContain("export function useCardHistoryPaginated");
    expect(historyQuery).toContain("limit: String(safePageSize + 1)");
    expect(modal).toContain('useWorkspaceFlag("lazy_card_history", true)');
    expect(modal).toContain("enabled={!lazyHistory || historyRequested}");
    expect(modal).toContain("if (open) setHistoryRequested(true);");
  });
});
