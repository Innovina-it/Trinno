/**
 * Declarative source of truth for the keyboard cheat-sheet (the `?` overlay).
 *
 * ShortcutsOverlay renders these groups verbatim — keep this list in sync
 * with the actual hand-wired handlers (nav chords, command palette, undo,
 * inbox nav, card-modal nav, roadmap zoom). This module is documentation,
 * not the binding layer: adding a row here does NOT wire a key. When you add
 * or change a real shortcut, add its row here so the overlay stays accurate.
 */

export type ShortcutRow = { keys: string; desc: string };
export type ShortcutGroup = { name: string; rows: ShortcutRow[] };

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    name: "Global",
    rows: [
      { keys: "?", desc: "Show this overlay" },
      { keys: "Cmd / Ctrl + K", desc: "Open command palette" },
      { keys: "Cmd / Ctrl + Z", desc: "Undo last action" },
      { keys: "Cmd / Ctrl + Shift + Z", desc: "Redo" },
      { keys: "/", desc: "Open command palette (search)" },
      { keys: "Esc", desc: "Close dialog or overlay" },
    ],
  },
  {
    name: "Navigation",
    rows: [
      { keys: "g r", desc: "Go to roadmap" },
      { keys: "g b", desc: "Go to boards" },
      { keys: "g l", desc: "Go to backlog" },
      { keys: "g t", desc: "Go to my tasks" },
      { keys: "g i", desc: "Go to inbox" },
      { keys: "g d", desc: "Go to dashboards" },
      { keys: "g w", desc: "Go to workload" },
    ],
  },
  {
    name: "Inbox",
    rows: [
      { keys: "j / ↓", desc: "Next" },
      { keys: "k / ↑", desc: "Previous" },
      { keys: "Enter", desc: "Open" },
      { keys: "e", desc: "Mark active read" },
      { keys: "Shift + E", desc: "Mark all read" },
    ],
  },
  {
    name: "Card modal",
    rows: [
      { keys: "[", desc: "Previous sibling card" },
      { keys: "]", desc: "Next sibling card" },
      { keys: "c", desc: "Toggle complete" },
      { keys: "Cmd / Ctrl + Enter", desc: "Send comment, save notes" },
    ],
  },
  {
    name: "Roadmap",
    rows: [
      { keys: "z / x  ·  − / +", desc: "Zoom out / in" },
      { keys: "n", desc: "New card" },
      { keys: "/", desc: "Focus search" },
      { keys: "Drag bar", desc: "Reschedule" },
      { keys: "Drag edges", desc: "Resize start or target" },
    ],
  },
];
