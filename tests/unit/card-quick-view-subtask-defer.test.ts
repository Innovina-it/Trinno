import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync("components/board/card-quick-view.tsx", "utf8");

describe("card-quick-view defers subtask creation until Save", () => {
  it("declares a DraftSubtask state queue separate from persisted rows", () => {
    expect(src).toContain("type DraftSubtask = { tempId: string; title: string }");
    expect(src).toContain("useState<DraftSubtask[]>([])");
  });

  it("includes queued drafts in the dirty diff so the footer morphs to Save", () => {
    expect(src).toContain("const draftsChanged = draftSubtasks.length > 0;");
    expect(src).toMatch(/dirty\s*=\s*[^;]*draftsChanged/);
  });

  it("queues subtask titles instead of calling the server in SubtaskSection", () => {
    expect(src).toContain("onQueueSubtask?: (title: string) => void;");
    expect(src).not.toMatch(/SubtaskSection[\s\S]{0,400}await onCreateSubtask/);
  });

  it("commits queued drafts via onCreateSubtask inside commitSave, after the field patch", () => {
    expect(src).toMatch(
      /if\s*\(onCreateSubtask && queuedDrafts\.length > 0\)[\s\S]{0,200}for \(const draft of queuedDrafts\)[\s\S]{0,200}await onCreateSubtask\(draft\.title\)/,
    );
  });

  it("drops queued drafts on discard via resetDrafts", () => {
    expect(src).toMatch(/resetDrafts[\s\S]{0,600}setDraftSubtasks\(\[\]\)/);
  });

  it("renders pending draft rows with a remove affordance", () => {
    expect(src).toContain('data-testid="card-quick-view-subtask-draft-row"');
    expect(src).toContain('data-testid="card-quick-view-subtask-draft-remove"');
    expect(src).toContain("PENDING");
  });
});
