# Plan #16b-γ-G — Drag-first Gantt manipulation

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.
>
> Mid-size slice (8 tasks, ~9.5 hr). Subagent commits per task or pair.

**Scope:** Make every roadmap mutation reachable through pointer drag — reorder rows, reparent across epic-lanes, paint new cards, set priority via gutter, auto-scroll, snap to dependencies, quick-add via header chip drag.

**Out of scope:**
- Touch DnD (mouse/trackpad only — same constraint as plan-13).
- Multi-select drag (separate slice).
- Cross-view drag (Kanban tile → roadmap band) — that's γ-Master D1.
- Marquee/lasso selection.

**Depends on:** plan-13 (RoadmapView, RoadmapBar pointer drag harness), plan #8 (`cards.parent_card_id` + cycle-guard trigger), plan #9 (`card_links` blocker kind), γ-A (cascade + critical path + dep arrows), γ-C (`cards.priority` enum + tile chip + persistent error pane), γ-Master A1-A9 (click-bar, overflow menu, search, **A4 +New card dialog**, hover tooltip, filter chips, keyboard shortcuts, epic-link), γ-Master B1 (`WorkspaceStoreProvider` on board pages), γ-Master B4 (`card_links` workspace realtime — gives live cross-board dep freshness for G6).

**Leverages recently completed work:**
- **A4 dialog** (`new-card-dialog.tsx`) — G3 + G7 reuse it via prefill props (`defaultStart`, `defaultTarget`, `defaultParent`, `defaultList`). No new dialog component.
- **A1 click-suppress logic** — G1 row-drag must use a separate handle (≡ icon) so bar click still opens modal. Pointer threshold (>4px) reused.
- **A2 overflow menu** — keyboard parity for G4 (priority via gutter): the menu already has "Edit dates / Archive" — add "Set priority ▸" submenu so non-mouse users hit the same enum.
- **A5 hover tooltip** — must hide on drag start (set `isDragging` flag in roadmap-view; tooltip subscribes).
- **A6 filter chips** — G3/G7 created card might be filtered out invisibly. After create, if filters would hide the card → flash a one-time toast: "Card created but hidden by current filters". No filter mutation.
- **A7 keyboard help (`?`)** — append new gestures section: row-reorder via handle, paint via empty drag, gutter via leftward drag, chip via header drag, snap via 4px window (Alt to bypass).
- **A8 epic-lane title link** — must keep working after G2 reparent. Lane row recomputes parent grouping on commit; link target rebinds.
- **B1 workspace store** — G4 priority write must invalidate workspace store entry for the card (Kanban tile shows priority chip from γ-C). Action already does this for `updateCard`; verify path is hit.
- **B4 card_links realtime** — G6 snap-to-dep reads `card_links` for blockers/dependents. With B4 live, snap candidates stay fresh even when a peer on another board edits a dep. No extra subscription needed.
- **γ-C error pane** — G2 reparent that violates plan #8's cycle-guard trigger will throw. Catch in action and route to existing error pane (not toast — error pane is the canonical surface).

---

## Decisions (locked)

| Choice | Decision | Why |
|---|---|---|
| Priority model | **Enum gutter** (1A) — `cards.priority` enum, 5 colored bands on roadmap edge. | Filterable across views. Survives cross-board. No collision with order axis. |
| Order model | **Decoupled `roadmap_order` int** (2A) — new column. | Two independent axes (time + visual order). No schema overload of `start_date`. |
| New-card affordance | **Both** drag-paint rect (G3) AND chip-drag (G7). | G3 = bounded card. G7 = single-drag for instant capture. |

---

## Schema additions

```sql
-- Migration: 2026-05-02-roadmap-order.sql
ALTER TABLE cards ADD COLUMN roadmap_order INT NULL;
CREATE INDEX cards_board_roadmap_order_idx ON cards (board_id, roadmap_order)
  WHERE roadmap_order IS NOT NULL;
```

`NULL` = unranked (default-sorted by `start_date ASC, created_at ASC`).
Reordering writes `roadmap_order` only on the moved card and any card it crosses (sparse re-numbering by 1024 to avoid full-list rewrites — same trick as Linear / Jira backlog).

---

## Tasks

### G1 — Drag row reorder (manual order) — 2 hr

**Files:**
- `supabase/migrations/2026-05-02-roadmap-order.sql` (new)
- `actions/roadmap-actions.ts` — add `reorderRoadmapRow({ cardId, beforeId, afterId })`
- `components/roadmap/roadmap-row.tsx` — add row-level drag handle (left edge, ≡ icon, only on hover)
- `components/roadmap/roadmap-view.tsx` — track row drag state separate from bar drag state

**UX:**
- Hover row gutter → ≡ handle appears.
- Press + drag handle → entire row floats vertically with reduced opacity ghost.
- Other rows yield (translate by row-height during drag).
- Drop → `reorderRoadmapRow` action → optimistic re-render.

**Sparse rank algorithm:**
```ts
// On drop between rows with rank A and B (either may be NULL):
//   if both NULL → assign incremental ranks to all 3 affected
//   else if A NULL → newRank = B - 1024
//   else if B NULL → newRank = A + 1024
//   else newRank = floor((A + B) / 2)
//   if (B - A) < 2 → renumber the whole board sparsely (rare)
```

**Verify:**
- Reorder persists after reload.
- Two cards with `roadmap_order = NULL` still sort by `start_date`.
- Activity feed entry: `card.roadmap_order` (new event type — extend trigger).

**Commit:** `feat(roadmap): G1 manual row reorder via drag handle`

---

### G2 — Drag bar across epic-lanes → reparent — 1.5 hr

**Files:**
- `components/roadmap/roadmap-view.tsx` — extend bar pointermove to detect lane crossings
- `components/roadmap/reparent-confirm-dialog.tsx` (new)
- `actions/cards-actions.ts` — `updateCard` already accepts `parent_card_id` (plan #8); ensure the path is exposed via roadmap drag handler

**Cycle-guard interaction (plan #8):**
- Plan #8 trigger raises `cards: parent cycle detected` on cycle attempt.
- Wrap reparent action in try/catch. On throw → push to γ-C error pane (`error.bus.push`) with friendly message: "Cannot move card under one of its descendants." Roadmap state rolls back optimistic move.

**UX:**
- Existing horizontal drag still moves dates.
- New: while dragging, if pointer Y crosses into a different epic-lane row → highlight target lane (border ring, no opacity change to bars).
- On pointerup in different lane:
  - If card has no dependencies that span the new parent → silent commit `parent_card_id = newEpicId`.
  - If breaks any dep (blocker on a card not under new epic) → confirm dialog: "Move under [Epic B]? Will break dependency on [Card X]."
- Visual: bar transitions vertically on commit (CSS transform animation, 200ms).

**Edge cases:**
- Dragging onto "No epic" lane → `parent_card_id = NULL`.
- Dragging within same lane → no-op for parent (only date change applies).

**Verify:**
- Reload preserves new parent.
- Critical-path recompute fires (card may now be on/off the critical path under new epic).
- Activity feed: `card.parent_changed`.

**Commit:** `feat(roadmap): G2 cross-epic-lane reparent via drag`

---

### G3 — Drag-paint empty area → new card — 1 hr

**Files:**
- `components/roadmap/roadmap-view.tsx` — empty-space pointerdown handler
- `components/roadmap/new-card-dialog.tsx` (A4) — extend prefill props if A4 didn't already expose `defaultStart`/`defaultTarget`/`defaultParent`/`defaultList`. Verify against A4's commit (`923d995 feat(roadmap): A4 + New card dialog with board+list+title+dates`); A4 has dates already, parent/list may need adding.

**UX:**
- Pointerdown on empty roadmap row (not on a bar, not on a handle) → start paint.
- Pointermove → render dashed ghost rect from down-X to current-X, snapped to day, full row height.
- Pointerup with delta < 4px → cancel (treat as click, no dialog).
- Pointerup with delta ≥ 4px → open A4's dialog with:
  - `defaultStart` = day at down-X
  - `defaultTarget` = day at up-X
  - `defaultParent` = epic of the row
  - `defaultList` = first list of the board (user can change)
- Esc during drag → cancel paint.

**Edge cases:**
- Painting backward (right→left) → swap so start ≤ target.
- Painting across multiple rows → constrain to row of pointerdown.

**Verify:**
- Created card appears in painted slot.
- Cancel via Esc leaves no card.
- Painted on epic lane → auto-attached to that epic.

**Commit:** `feat(roadmap): G3 drag-paint empty area to create card`

---

### G4 — Priority gutter — 1.5 hr

**Files:**
- `components/roadmap/roadmap-view.tsx` — left gutter component
- `components/roadmap/priority-gutter.tsx` (new)
- `actions/cards-actions.ts` — already supports `priority` from γ-C
- `components/roadmap/roadmap-bar-overflow-menu.tsx` (A2) — add "Set priority ▸" submenu for keyboard parity (5 enum values)

**UX:**
- Left gutter strip, 64px wide, sticky to viewport (independent of horizontal scroll).
- 5 colored bands stacked vertically: Highest (red) → Lowest (gray).
- Each band labeled with text + icon.
- Toggle button in roadmap header: "Priority gutter" on/off (URL state, default off).
- Drag bar leftward beyond x=0 → bar enters gutter area, snaps to band under pointer Y.
- Pointerup in band → write `cards.priority = band.value`. Bar returns to its row position with new priority tint.
- Bars are tinted by their priority always (regardless of gutter visibility).

**Edge cases:**
- Drop outside any band (e.g., above top) → snap to closest.
- Bar tint must work alongside critical-path stroke (priority = fill, critical = border).

**Verify:**
- Tile in Kanban shows updated priority chip after roadmap drag (B1 workspace store invalidation path hit).
- Activity feed: `card.priority`.
- Overflow-menu submenu sets same enum value via keyboard.

**Commit:** `feat(roadmap): G4 priority gutter (drag bar to set enum) + overflow-menu parity`

---

### G5 — Auto-scroll near viewport edge — 30 min

**Files:**
- `components/roadmap/roadmap-view.tsx` — add scroll loop on drag

**UX:**
- During any active drag (bar move, edge resize, row reorder, paint, gutter):
  - If pointer within 40px of left or right viewport edge → start `requestAnimationFrame` scroll loop, accelerating to 8px/frame at edge.
  - If pointer within 40px of top/bottom → vertical scroll same.
  - Stop loop on pointerup or when pointer leaves edge zone.

**Verify:**
- Drag bar to right edge → roadmap scrolls right; bar follows pointer (relative position maintained).
- Stops cleanly on release.

**Commit:** `feat(roadmap): G5 auto-scroll on edge drag (promote γ-Master C3)`

---

### G6 — Snap to dependency ends — 1 hr

**Files:**
- `components/roadmap/roadmap-view.tsx` — extend bar pointermove to compute snap candidates

**Realtime hook-up (B4):**
- Snap candidates derive from `card_links` rows already in the workspace store.
- B4's workspace realtime extension means cross-board dep edits propagate live → snap candidates stay current without polling.
- No new subscription. Just read from existing store.

**UX:**
- During bar drag, compute target-day from pointer X.
- Inspect this card's blockers (cards it depends on) and dependents (cards depending on it).
- For each, compute their `target_date` / `start_date` in pixels.
- If pointer X within 4px of any candidate date (dragging start vs target):
  - Snap pointer position to candidate.
  - Show 1px vertical guide line at snap point + small "→ [Card X]" label.
- Hold Alt to disable snap.

**Edge cases:**
- Multiple snap candidates within window → snap to nearest.
- Snapping should respect existing day-snap (snap to candidate date, not raw pixel).

**Verify:**
- Drag A's left edge near B's target → snaps exactly. Confirm dates equal in DB.
- Alt-drag bypasses snap.

**Commit:** `feat(roadmap): G6 snap to dependency ends (promote γ-Master C4)`

---

### G7 — Drag-from-chip → drop on row — 1 hr

**Files:**
- `components/roadmap/roadmap-header.tsx` — add `<DraggableNewCardChip />` button-as-handle
- `components/roadmap/roadmap-view.tsx` — accept drop on rows
- Reuses A4 dialog with prefill props from G3

**UX:**
- Header chip: "✚ Drag onto roadmap to create" + grip dots.
- Pointerdown on chip → grab cursor, ghost chip floats with pointer.
- Hovering over a row → row highlights.
- Hovering over a day column → day column highlights.
- Pointerup on row at day X → open A4 dialog with `defaultStart = X`, `defaultTarget = X + 7d` (1-week default duration), `defaultParent = lane epic`.
- Pointerup outside roadmap → cancel, no dialog.

**Difference from G3:**
- G3: pointerdown happens on roadmap empty space (no chip). Bounded by drag rect.
- G7: pointerdown on header chip. Single click-day, default 1-week duration.

Both end in the same A4 dialog with different prefills.

**Verify:**
- Chip drag onto row → dialog opens with correct prefill.
- Cancel chip drag (drop outside) → no card created.
- Card appears at drop point on confirm.

**Commit:** `feat(roadmap): G7 draggable new-card chip in header`

---

### G8 — E2E + verify — 1 hr

**File:** `tests/e2e/gantt-drag-first.spec.ts` (new)

**Specs:**
1. **Row reorder persists:** seed 3 cards no rank → drag #3 above #1 → reload → order is 3,1,2.
2. **Reparent across epics:** drag bar from Epic A's lane to Epic B's lane → confirm dialog (mock no-deps case to skip) → reload → `parent_card_id = epicB.id`.
3. **Drag-paint creates card:** pointerdown on empty space, drag 5 days, pointerup → dialog opens with start/target prefilled → submit → card visible in painted slot.
4. **Priority gutter:** toggle gutter on, drag bar leftward into "High" band → reload → `cards.priority = 'high'`.
5. **Snap to dep:** A blocks B (A.target=Jun 1). Drag B.start to Jun 2 (1px off snap) → snaps to Jun 1 exactly. Verify.
6. **Chip drag:** drag header chip onto row, drop on Jul 15 → dialog opens with start=Jul 15, target=Jul 22 → submit → card visible.

**Constraints:**
- Use `@playwright/test` `dragTo` with `sourcePosition`/`targetPosition` for pixel control.
- Each spec independent (own seed). No shared state.

**Pre-flight:**
- `npx tsc --noEmit`
- `npm run build`
- `npm run test:unit`
- All existing roadmap E2E specs (γ-A, γ-CRUD, γ-Master A) still pass.

**Commit:** `test(e2e): G8 drag-first roadmap specs (G1-G7)`

---

## Suggested execution order

```
G1 (schema + reorder)
  └─ G2 (reparent — uses similar drop-target logic from G1)
       └─ G3 (drag-paint — uses A4 dialog)
            └─ G7 (chip-drag — uses same dialog prefill path)
G4 (priority gutter — independent, can land any time after G1)
G5 (auto-scroll — affects G1/G2/G3/G4/G6, build after them)
G6 (snap-to-dep — independent)
G8 (E2E last)
```

Subagent batches: `[G1+G2]`, `[G3+G7]`, `[G4]`, `[G5+G6]`, `[G8]`.

---

## Constraints

- No new deps. Pointer events only (no dnd-kit for the bar — preserves plan-13's "raw pointer*" approach).
- Preserve all existing `data-testid`s and accessible names from plan-13, γ-A, γ-CRUD, γ-Master A1-A8.
- Mono palette intact. Priority colors must come from existing γ-C priority tints.
- Keyboard parity: every drag-only interaction has a non-mouse equivalent.
  - G1 row reorder → up/down arrow on focused row + `Cmd+Shift+↑/↓` to move (extend A7 shortcut handler).
  - G2 reparent → "Move to epic ▸" entry in A2 overflow menu.
  - G3/G7 new card → existing `n` shortcut from A7 + A4 dialog.
  - G4 priority → "Set priority ▸" submenu in A2 overflow menu.
  - G6 snap → toggle via Alt during drag (drag-only nuance, not gesture-required for keyboard users; date input via A2 "Edit dates" already exact).
- After each task: `npx tsc --noEmit` + `npm run build` + `npm run test:unit` clean.
- After landing the slice: update `docs/superpowers/concerns.md` — flip 🟡 entries for "Auto-scroll", "Snap to dep ends", "Inline date input rejected" (still rejected, no change), and remove "Drop bar in empty area click" if D2 is now superseded by G3+G7.

---

## Self-review notes

- **Supersedes γ-Master D2** (click-empty-area new card). G3 (drag-paint) is the richer version + G7 (chip drag) is the single-drag version. Recommend dropping D2 from γ-Master once G lands. Update master plan + queue when picking up G.
- **`roadmap_order` is sparse-int** like Linear / Jira backlog. Renumber threshold (B-A < 2) is rare; full sparse rewrite is `O(n)` but n ≤ ~200 in practice.
- **G2 reparent dialog** only fires on dep-break. Most drags are silent — important for flow.
- **G3 vs G7** — both end at A4 dialog. The duplication is intentional UX (different mental model: "I know the bounds" vs "drop me here, I'll figure dates later").
- **G4 gutter is opt-in** (URL toggle). Default off avoids stealing horizontal screen real estate.
- **G6 snap** uses 4px threshold. If users complain it triggers too often, expose threshold in user prefs (post-v1).
- **G5 auto-scroll** speed (8px/frame at edge ≈ 480px/sec at 60fps) — same speed as Notion/Linear. Tunable.
- **Critical-path interaction with G2:** reparenting recomputes the path. UI must re-flash bars that changed critical state. Existing γ-A code already subscribes to dep changes; verify it covers `parent_card_id` change too. If not, add.
- **No virt impact:** roadmap virtualization is deferred (concerns.md). G1's reorder loop assumes all rows in DOM. Fine for n ≤ 200.

---

## Estimated effort

| Task | Effort |
|---|---|
| G1 reorder | 2 hr |
| G2 reparent | 1.5 hr |
| G3 paint | 1 hr |
| G4 gutter | 1.5 hr |
| G5 auto-scroll | 30 min |
| G6 snap | 1 hr |
| G7 chip drag | 1 hr |
| G8 E2E | 1 hr |
| **Total** | **~9.5 hr** subagent (~1 day) |
