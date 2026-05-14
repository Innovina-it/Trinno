/**
 * Plan #16b-γ-B (#1) — Board templates.
 *
 * A template seeds a new board with a fixed set of lists (each pre-mapped to a
 * roadmap status_kind from γ-A) and a starter label palette. Picking a
 * template reduces empty-board friction; "blank" stays available for users
 * who want to bring their own structure.
 *
 * Colors are monochrome by design — the workspace palette is grayscale and
 * users re-color labels post-creation if they want chroma.
 */
export type BoardTemplateId = "blank" | "standup" | "bug_triage" | "okr_sprint";

export type BoardTemplateListSpec = {
  title: string;
  statusKind?: "todo" | "in_progress" | "review" | "done" | "blocked";
};

export type BoardTemplateLabelSpec = {
  name: string;
  color: string;
};

export type BoardTemplate = {
  id: BoardTemplateId;
  name: string;
  description: string;
  lists: BoardTemplateListSpec[];
  labels: BoardTemplateLabelSpec[];
};

export const DEFAULT_LIST_TEMPLATES: Array<{ name: string }> = [
  { name: "Todo" },
  { name: "In Progress" },
  { name: "Done" },
];

export const BOARD_TEMPLATES: BoardTemplate[] = [
  {
    id: "blank",
    name: "Blank",
    description: "Empty board. Add your own lists.",
    lists: [],
    labels: [],
  },
  {
    id: "standup",
    name: "Daily standup",
    description: "Today / Yesterday / Blockers.",
    lists: [
      { title: "Yesterday", statusKind: "done" },
      { title: "Today", statusKind: "in_progress" },
      { title: "Blockers", statusKind: "blocked" },
    ],
    labels: [
      { name: "blocker", color: "#fafafa" },
      { name: "fyi", color: "#fafafa" },
    ],
  },
  {
    id: "bug_triage",
    name: "Bug triage",
    description: "Inbox / Triaging / In progress / Verifying / Closed.",
    lists: [
      // "Inbox" is intentionally unmapped — it represents items not yet
      // triaged, distinct from the "todo" pipeline state.
      { title: "Inbox" },
      { title: "Triaging", statusKind: "todo" },
      { title: "In progress", statusKind: "in_progress" },
      { title: "Verifying", statusKind: "review" },
      { title: "Closed", statusKind: "done" },
    ],
    // Severity (P0–P4) is owned by the `priority` enum on the card row, not
    // labels. These labels are categorical bug-triage tags only.
    labels: [
      { name: "regression", color: "#fafafa" },
      { name: "crash", color: "#fafafa" },
      { name: "data-loss", color: "#fafafa" },
      { name: "ui", color: "#fafafa" },
      { name: "perf", color: "#fafafa" },
    ],
  },
  {
    id: "okr_sprint",
    name: "OKR / Sprint",
    description: "Backlog → Sprint → In progress → Review → Done.",
    lists: [
      { title: "Backlog", statusKind: "todo" },
      // "This sprint" is intentionally unmapped — its semantic ("queued
      // for current sprint") is distinct from "in_progress" (which is
      // already taken by the next list) and from "todo" (which Backlog
      // owns). Leaving unmapped avoids colliding with the
      // (board_id, status_kind) partial unique index from migration 0054.
      { title: "This sprint" },
      { title: "In progress", statusKind: "in_progress" },
      { title: "Review", statusKind: "review" },
      { title: "Done", statusKind: "done" },
    ],
    labels: [
      { name: "objective", color: "#fafafa" },
      { name: "key-result", color: "#fafafa" },
    ],
  },
];

export function getBoardTemplate(id: BoardTemplateId): BoardTemplate {
  const t = BOARD_TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown board template: ${id}`);
  return t;
}
