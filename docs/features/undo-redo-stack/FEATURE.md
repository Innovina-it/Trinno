# FEATURE — undo-redo-stack (Gate 1-F)

Status: ACCEPTED at Gate 4 by Ali, 2026-06-12 (all 8 units; commits 7e2d080…f84fd9e). Evidence: evidence/D1-feature-evidence.md
Approved at Gate 1-F 2026-06-11 (as-is, incl. 10-min max age); Gate 2-F approved with E1 added.
Tier: 2 (shared component — global bus consumed by 41 call sites; server actions; no DB/schema/auth → no Tier 3 units)
Recon: [recon.md](recon.md), frozen 2026-06-11, collision resolved

## Goal

Upgrade the single-entry, 8-second undo bus into a bounded **50-entry undo stack with redo**, driven by keyboard (Ctrl/Cmd+Z undo, Ctrl+Shift+Z / Cmd+Shift+Z redo), and wire it into the roadmap Gantt — bar drag/resize/move, cascade shifts (composite), row reorder, move-to-board — and roadmap entities (milestones, dependency links, card link chip, card members from roadmap). Undo/redo works cross-surface: an action done on the roadmap is reversible while viewing the board and vice versa, with both surfaces updating live.

## Done looks like (observable, in the running app)

1. Drag a Gantt bar → Ctrl+Z restores its dates → Ctrl+Shift+Z re-applies the drag. Same for resize and lane move.
2. Five sequential edits undo in strict reverse order; stack holds up to 50; redo stack clears on a new action (standard editor semantics).
3. A cascade shift affecting N cards undoes as **one** step — all N cards' dates restored together.
4. Milestone create/update/delete, dependency-link add/remove, and card-link-chip set/remove are each undoable and redoable from the roadmap.
5. Do an edit on the roadmap, switch to the board, press Ctrl+Z → the edit reverts and the board view live-patches. Mirror direction works too.
6. With focus in an input / textarea / contenteditable, Ctrl+Z performs native text undo — the app stack does not fire.
7. The existing undo banner still appears on push and its UNDO button still works (banner shows the latest entry; keyboard walks the full stack).
8. Each undo/redo gives visible feedback (toast naming the reverted action).

## Must-not-change (product invariants)

- `undoBus.push({message, undo})` call signature stays **byte-compatible** — the 41 existing board call sites ship zero diffs and gain multi-step undo for free. `redo` is an optional new field.
- Banner UX unchanged: bottom-center, message + UNDO + dismiss, mounted once in the authed layout.
- Baselines workflow (approve/compare) stays **outside** undo scope — its approved-state semantics are not quick-edits.
- No DB or schema changes anywhere in the feature.
- Realtime patching (use-board-realtime / use-workspace-realtime) is consumed as-is, not modified.
- Native browser text-editing undo in form fields is never shadowed.
- Existing card-modal hotkeys (`[`, `]`, `c`, Escape) keep working; no new conflicts.

## Decided at spec time (was open in recon)

**Stale-write mitigation:** per-entry **max age of 10 minutes** — entries older than that are dropped from both stacks (lazy prune on invoke/push). Rationale: bounds the stale-overwrite window a 50-entry stack would otherwise leave open for hours, without a confirm-dialog interruption; server validation remains the backstop. The banner's 8s display window is now display-only — dismissing the banner no longer discards the entry (it stays in the stack).

## Redo coverage policy

Redo requires per-action `redo()` info that no existing site provides. Mechanism ships in Epic A; roadmap sites (Epics B/C) provide `redo` from day one; the 41 board sites keep undo-only until incrementally upgraded (out of this feature's scope — harvest candidate).

## Epics (detailed in decomposition.md, Gate 2-F)

- **A — core**: stack + redo mechanism, hotkeys hook with focus guard, feedback toast, unit tests. Zero call-site changes.
- **B — Gantt scheduling**: drag/resize/move, cascade composite entries, row reorder, move-to-board.
- **C — roadmap entities**: milestones, dependency links, card link chip, card members; confirm deliverable view rides the same actions.
- **D — cross-surface verification**: board↔roadmap coherence, realtime interplay, full evidence.

## Verification preconditions (feature-level)

- Local dev server; QA workspace (qa-unitb-a@innovina.it / Test Workspace / QA Board) with a roadmap-enabled board: scheduled cards, ≥1 milestone, ≥1 dependency link.
- Litmus checkpoint before each unit dispatch.
- No special env/seed beyond the above; no DB changes to roll back.
