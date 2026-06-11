# Recon — undo-redo-stack (Gate 0, frozen 2026-06-11)

## User focus (verbatim intent)
Main focus: undo/redo working in the **roadmap Gantt edits** and the **cards touched during work**. All changeable entities covered (links, deliverables). The same functionality must work **directly and indirectly with boards** (an action done on the roadmap is undoable from the board context and vice versa; surfaces stay coherent).

## What exists today

### Core infrastructure
- `lib/undo-bus.ts` (105 lines): global in-memory bus, **single entry**, 8s retention (`RETENTION_MS = 8_000`), API: `push({message, undo})`, `invoke()`, `dismiss()`, `subscribe()`, `snapshot()`, `_resetForTests()`. New push replaces pending entry (Gmail UX). No redo concept. No unit tests found.
- `components/undo-banner.tsx`: bottom-center toast, UNDO + dismiss, mounted once at `app/(app)/layout.tsx:212`.
- **41 `undoBus.push` call sites across 22 files** — all board-side: card sections (members, priority, comments, attachments, owner, parent, story-points, roadmap-dates, checklists, time, card-links, complete, cover, labels, due, subtasks), list-column, board-view, card-modal, bulk-action-bar, inbox-list, component-card-section. All supply `message` + `undo()` only — **no redo info anywhere**.
- `push()` API can stay byte-identical for the stack upgrade → the 41 sites need **zero changes** to gain multi-step undo.

### Roadmap (the gap)
- **Zero `undoBus` usage in `components/roadmap/`** — no Gantt edit is undoable today.
- Mutation surface (imports in roadmap components): `@/actions/cards` (8× — `updateCard` ×7), `@/actions/milestones` (create/update/delete), `@/actions/links` (4×), `@/actions/card-members` (2×), `@/actions/roadmap-baselines` (5×).
- Bar drag/resize commits at `use-roadmap-drag-harness.ts:339` (`await updateCard({...})`); harness also imports `reorderRoadmapRow`, `moveCardToBoard`, and `CascadeAffectedCard` — **cascade shifts move MULTIPLE cards** (cascade-confirm-dialog.tsx) → undo entry must be composite (restore all affected cards' dates in one undo).
- Dependency arrows: `RoadmapLink {fromId, toId}` = "fromId is_blocked_by toId" (schema enum `blocks` / `is_blocked_by`, schema.ts:286). Exact mutation action to pin in epic recon.
- Card link chip: `upsertCardLink({cardId,...})` / `removeCardLink({cardId})` (1 link per card, actions/links.ts).
- Milestones table (schema.ts:726): id, workspaceId, boardId?, name, date, description, color, icon. Actions: createMilestoneImpl/updateMilestoneImpl/deleteMilestoneImpl.
- "Deliverable" = roadmap **view mode** (`gantt | list | deliverable | milestone`, roadmap-header.tsx:44; `RoadmapDeliverableView` in roadmap-view.tsx:2347). Edits in that view go through the same card/link actions — confirm in epic recon.
- Baselines: approval/compare workflow (actions/roadmap-baselines.ts) — recommend EXCLUDE from undo scope (not a quick-edit; has its own approved-state semantics).

### Keyboard
- No global hotkey registry. Existing keydown listeners: card-modal (`[`, `]`, `c`, Escape), bulk-action-bar (Escape), dialogs (Escape) — **no Ctrl+Z / Ctrl+Shift+Z conflicts**.
- Focus guard required: skip global undo when target is `input, textarea, [contenteditable]` so native text undo wins.

### Cross-surface coherence ("indirectly with boards")
- The bus is global and mounted in the authed layout → an entry pushed on the roadmap is invokable from any page.
- Undo callbacks run server actions; realtime (use-board-realtime / use-workspace-realtime) patches both surfaces → undoing a roadmap drag while on the board updates the board live. This already works for the 41 board sites; same mechanics extend to roadmap pushes.

## Discrepancies vs the original document
- "Reversal logic in 10 scattered places, needs collecting" → already centralized since commit `7083597`; 41 compatible sites.
- Redo ("Ctrl+Shift+Z walks forward") requires per-action `redo()` info that NO site provides → redo ships as mechanism + gets wired per entity (roadmap sites get it from day one; board sites incrementally).
- Roadmap was not mentioned in the doc but is the user's main focus and has zero coverage.

## ⚠️ In-flight collision — RESOLVED 2026-06-11
User's roadmap edits landed as `2b1fd49` (feat(roadmap): inline removed-since-baseline phantoms in original lanes). Working tree clean; Epic B/C have no file exclusions.

## Stale-write risk (carried, accepted at 8s today)
Undoing an old action after a teammate changed the same entity writes stale data. A 50-entry stack widens the window. Mitigation candidates at spec time: per-entry max age, confirm dialog for entries older than N minutes, or accept (server validation still applies).

## Proposed epic structure (for Gate 2-F)
- **Epic A — core**: bus → bounded 50-entry undo stack + redo stack, optional `redo()` on entries, hotkeys hook (Ctrl/Cmd+Z, Ctrl+Shift+Z / Cmd+Shift+Z) with focus guard, keyboard feedback (toast), banner unchanged, unit tests. Zero call-site changes.
- **Epic B — Gantt scheduling**: wire undo+redo into bar drag/resize/move (drag harness commit), cascade shifts (composite entry), row reorder, move-to-board.
- **Epic C — roadmap entities**: milestones (create/update/delete), dependency links, card link chip, card members from roadmap; verify deliverable view rides the same actions; baselines EXCLUDED.
- **Epic D — cross-surface verification**: board↔roadmap undo coherence, realtime interplay, full evidence.

## Verification preconditions (feature-level)
- Local dev server + the QA workspace/board from the members work (qa-unitb-a@innovina.it / Test Workspace / QA Board) reusable; needs a roadmap-enabled board with scheduled cards + a milestone + a dependency link.
- No DB changes anywhere in this feature.
