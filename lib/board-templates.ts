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
      { title: "Inbox", statusKind: "todo" },
      { title: "Triaging", statusKind: "todo" },
      { title: "In progress", statusKind: "in_progress" },
      { title: "Verifying", statusKind: "review" },
      { title: "Closed", statusKind: "done" },
    ],
    labels: [
      { name: "P0", color: "#fafafa" },
      { name: "P1", color: "#fafafa" },
      { name: "P2", color: "#fafafa" },
      { name: "regression", color: "#fafafa" },
    ],
  },
  {
    id: "okr_sprint",
    name: "OKR / Sprint",
    description: "Backlog → Sprint → In progress → Review → Done.",
    lists: [
      { title: "Backlog", statusKind: "todo" },
      { title: "This sprint", statusKind: "todo" },
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
