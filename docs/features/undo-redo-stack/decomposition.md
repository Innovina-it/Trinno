# Decomposition — undo-redo-stack (Gate 2-F)

Status: APPROVED at Gate 2-F, 2026-06-11 (8 units incl. E1, order A1→A2→B1→B2→C1→C2→E1→D1)
Feature spec: [FEATURE.md](FEATURE.md) (approved Gate 1-F, 2026-06-11)

## Units

| Unit | Epic | Scope (one done-statement each) | Tier | Lane | Depends on |
|------|------|--------------------------------|------|------|------------|
| A1 | A core | `lib/undo-bus.ts` → bounded 50-entry undo stack + redo stack; optional `redo()` field; 10-min lazy max-age prune; dismiss hides banner but keeps entry; redo stack clears on new push; unit tests. Zero call-site changes. | 2 | self | — |
| A2 | A core | Global hotkeys hook (Ctrl/Cmd+Z, Ctrl+Shift+Z / Cmd+Shift+Z) with focus guard (input/textarea/contenteditable), mounted in authed layout; feedback toast naming the undone/redone action. | 2 | self | A1 |
| B1 | B Gantt | Bar drag/resize/lane-move undo+redo at the drag-harness commit point (`use-roadmap-drag-harness.ts:339`): push entry with prev/next dates + redo. | 2 | self | A1 (A2 for live testing) |
| B2 | B Gantt | Cascade shift as ONE composite entry (restore all affected cards together), row reorder, move-to-board undo+redo. | 2 | self | B1 |
| C1 | C entities | Milestone create/update/delete undo+redo (create⇄delete inverse pairs; update restores prior fields). | 2 | self | A1 |
| C2 | C entities | Dependency links add/remove, card-link chip set/remove, card members from roadmap, undo+redo; confirm deliverable view rides the same actions (recon open point). | 2 | self | C1 |
| E1 | E board redo | Add `redo()` to the 16 card-field push sites (archive, title, description, complete ×3, members, priority, owner, parent, story points, roadmap dates, estimate, due, cover, labels, card links, component). Mechanical: each site already holds prev+next in closure; redo mirrors the forward write. Comments/attachments/checklists/bulk/inbox stay undo-only (ID-rebirth, blob-loss, blast-radius issues). | 2 | self | A1 |
| D1 | D verify | Cross-surface evidence run: roadmap edit undone from board view + reverse, realtime live-patch both directions, full tripwire pass, feature-level evidence note. No production code. | 2 | self (main session verifies) | all (incl. E1) |

## Dependency map

```
A1 ── A2
 ├──── B1 ── B2 ─┐
 └──── C1 ── C2 ─┤
                 D1
```

## Parallel-safety

- B-chain vs C-chain write-sets are disjoint (drag harness + cascade dialog vs milestone + link components) → parallel-safe in principle.
- All build lanes are `self` → execution is sequential anyway; parallelism unused. WIP limit (max 2 unverified) never approached.
- A1 and A2 are NOT parallel-safe with anything: every later unit consumes the bus API A1 defines.

## Dispatch order

A1 → A2 → B1 → B2 → C1 → C2 → E1 → D1

(B-chain before C-chain: Gantt drag is the user's stated main focus; if a session break lands mid-feature, the highest-value slice is already done.)

## Session plan

One unit per session (large-feature protocol). Each unit session: read FEATURE.md + this file + its unit card → Gate 1 (unit spec via unit card) → build → Gate 4 (evidence) → harvest note. Litmus checkpoint `pre-<unit>` before each dispatch.

## Verification preconditions (per-unit deltas)

- A1: none beyond repo (pure lib + unit tests).
- A2: dev server; any board page to test focus guard.
- B1/B2: QA roadmap board with scheduled cards; B2 additionally a cascade-triggering dependency chain.
- C1/C2: ≥1 milestone, ≥1 dependency link, a card with link chip.
- D1: two browser contexts (board view + roadmap view) for realtime cross-patch evidence.
