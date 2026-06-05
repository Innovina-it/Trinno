// Plan #16b-γ-A (#2) — derive a card's roadmap status from its list's
// `statusKind` column. The mapping is one-to-one: a list with no
// `statusKind` produces null (the bar falls back to the default fill).

import type { CSSProperties } from "react";

export type StatusKind =
  | "todo"
  | "in_progress"
  | "review"
  | "done"
  | "blocked";

// Plan #16b-γ-Gantt-B (B3) — shared human-readable labels for the five
// statusKind values. Used by the Roadmap bar's tooltip and by the Kanban
// tile's status badge. Keep here so both consumers stay in sync without a
// UI→roadmap dep.
export const STATUS_LABEL: Record<StatusKind, string> = {
  todo: "to do",
  in_progress: "in progress",
  review: "review",
  done: "done",
  blocked: "blocked",
};

// Plan #epic-as-kanban — display titles used when auto-creating a list
// for a given status_kind. Mirrors STATUS_LABEL but in title-case for
// list-name (a list called "in progress" lower-case looks wrong).
export const STATUS_DEFAULT_TITLE: Record<StatusKind, string> = {
  todo: "Todo",
  in_progress: "In progress",
  review: "Review",
  done: "Done",
  blocked: "Blocked",
};

type CardLike = { listId: string };
type ListLike = { id: string; statusKind: StatusKind | null };

/**
 * Returns the StatusKind associated with the card's current list, or null
 * when the list is unmapped (or the card's list isn't in the provided
 * lookup — which can happen briefly during a list-deletion CDC race).
 */
export function getCardStatusKind(
  card: CardLike,
  lists: ListLike[],
): StatusKind | null {
  const l = lists.find((x) => x.id === card.listId);
  return l?.statusKind ?? null;
}

// ── Canonical status-bar fill ─────────────────────────────────────────────
// DESIGN.md §"Roadmap Bar Patterns" — the five status fills carry a texture
// (not just a hue) so state reads without color: color-blind safe + legible
// at reduced saturation on near-black. These patterns are constants shared by
// every gantt surface (roadmap bars + the Home "MY WEEK" mini-gantt) so the
// two surfaces stay one system. Do not introduce a sixth texture without
// updating DESIGN.md and the roadmap legend in components/shortcuts-overlay.
//
//   todo        solid 22%
//   in_progress solid 38% + 1px inset ring 55% + pulse (the pulse is the
//               texture; globals.css kills it under prefers-reduced-motion)
//   review      45° diagonal stripes over 22% base ("waiting on a human")
//   done        horizontal hatches over 22% base ("closed and frozen")
//   blocked     12–18% fill + 2px inset ring 60% ("fenced off")
//
// `isHeader` bumps the blocked/neutral fill for epic header bars. `motion`
// disables the in-progress pulse for static contexts (legend swatches).
export function statusBarFill(
  status: StatusKind | null,
  opts: { isHeader?: boolean; motion?: boolean } = {},
): { className: string; style: CSSProperties } {
  const { isHeader = false, motion = true } = opts;
  if (!status) {
    return { className: isHeader ? "bg-fg/15" : "bg-fg/8", style: {} };
  }
  switch (status) {
    case "todo":
      return {
        className: "",
        style: {
          background: "color-mix(in oklab, var(--status-todo) 22%, transparent)",
        },
      };
    case "in_progress":
      return {
        className: motion ? "ring-1 ring-inset animate-pulse" : "ring-1 ring-inset",
        style: {
          background: "color-mix(in oklab, var(--status-in-progress) 38%, transparent)",
          boxShadow:
            "inset 0 0 0 1px color-mix(in oklab, var(--status-in-progress) 55%, transparent)",
        },
      };
    case "review":
      return {
        className: "",
        style: {
          background: "color-mix(in oklab, var(--status-review) 22%, transparent)",
          backgroundImage:
            "repeating-linear-gradient(45deg, color-mix(in oklab, var(--status-review) 45%, transparent) 0 4px, transparent 4px 8px)",
        },
      };
    case "done":
      return {
        className: "",
        style: {
          background: "color-mix(in oklab, var(--status-done) 22%, transparent)",
          backgroundImage:
            "repeating-linear-gradient(0deg, color-mix(in oklab, var(--status-done) 50%, transparent) 0 2px, transparent 2px 6px)",
        },
      };
    case "blocked":
      return {
        className: "ring-2 ring-inset",
        style: {
          background: isHeader
            ? "color-mix(in oklab, var(--status-blocked) 18%, transparent)"
            : "color-mix(in oklab, var(--status-blocked) 12%, transparent)",
          boxShadow:
            "inset 0 0 0 2px color-mix(in oklab, var(--status-blocked) 60%, transparent)",
        },
      };
  }
}
