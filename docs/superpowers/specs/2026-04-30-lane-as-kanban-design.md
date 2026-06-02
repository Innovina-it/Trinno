# Roadmap-First with Lane-as-Kanban — Design Specification

**Date:** 2026-04-30 (revision: pivoted from epic-as-kanban)
**Status:** Approved for implementation planning
**Scope:** Invert workspace mental model. Roadmap becomes the primary working surface. **Every lane on the roadmap** (epic / assignee / component / orphan) is clickable and opens a kanban view of the lane's cards, grouped by `lists.status_kind`. Boards remain available but are demoted from the workspace landing.

**Predecessor spec:** `2026-04-30-epic-as-kanban-design.md` — superseded by this document. Epic-only kanban becomes a special case of the generic lane-as-kanban model.

---

## 1. Goals & Non-Goals

### Goals

- Make the roadmap the workspace's default landing page.
- Make **every** lane on the roadmap (regardless of grouping mode) a clickable kanban portal.
- Kanban columns are the five fixed `status_kind` values: `todo` / `in_progress` / `review` / `done` / `blocked` (+ optional Unmapped).
- Lane cards may span multiple boards. Drag updates `card.list_id` to a list with the target `status_kind` **on the card's own home board**. Auto-create the list if missing.
- Surface orphan cards (matching no current grouping) in an "Unassigned" lane.
- Zero new tables. Minimal schema churn (one trigger drop).

### Non-Goals

- Nested epics (epic-of-epic) — disallowed.
- Per-lane customizable columns — fixed 5 columns for v1.
- Decoupling `cards.status` from `list_id`.
- Cross-board DnD (drag a card across boards inside a lane-kanban) — children move within their own board only.
- Cross-workspace lane-kanbans.

---

## 2. Decision log

| # | Decision | Choice | Rationale |
|---|---|---|---|
| Q1 | What can own a kanban? | Any roadmap lane: epic, assignee, component, sprint (future), orphan. | Lanes are filter predicates — kanban = predicate + status grouping. Generic over specific. |
| Q2 | Relationship to existing boards? | Coexist. Boards survive, demoted from landing. | Lanes group across boards; boards still hold the actual lists. |
| Q3 | Data model | Synthetic view, no new tables. Cards filtered by lane predicate, grouped by `lists.status_kind`. | Reuses status_kind shipped in γ-A. No schema bloat. |
| Q4 | Descendant depth in lane-kanban | Direct match only — for epic lanes, direct children; for assignee lanes, direct membership; etc. | Avoids mixing card sizes in a single column. |
| Q5 | Cards matching no current lane | "Unassigned" lane (UI-only, no schema). | Lowest friction. |
| Q6 | Navigation | Full-page route `/w/{ws}/lane/{kind}/{id}`. | Deep-linkable, predictable, no overlay complexity. `kind ∈ {epic, assignee, component, orphan}`. |
| Q7 | Kanban columns | Fixed 5 status_kind values. | Consistent app-wide. |
| Q8 | Drag updates which `list_id`? | The card's **own** home board's list with target status_kind. Auto-create if missing. | Cards stay on their boards. Lanes are pure groupings. |
| Q9 | Child-card board co-location | **None.** Cards live wherever they live. | Removes the "epic owns a board family" coupling that complicated the prior spec. Lanes flexible across boards. |
| Q10 | Nested epics? | No. Single-level only. Trigger-enforced. | Semantic rule independent of presentation. |
| Q11 | What appears on the roadmap? | Every lane title is a clickable kanban portal. Epics expanded by default with date-bearing children as nested rows. | Roadmap = calendar (dates) + portal (status). |
| Q12 | Workspace landing | Roadmap. `/w/{ws}` 307s to `/w/{ws}/roadmap`. Boards page at `/w/{ws}/boards`. | Roadmap is the "main working place." |

---

## 3. Architecture

```
Workspace
├── Roadmap (/w/{ws}/roadmap) ← LANDING (307 redirect from /w/{ws})
│   ├── Lane mode picker (epic | assignee | component) [existing]
│   ├── Lane rows (each title clickable → lane-kanban)
│   │   └── Children with dates as nested rows
│   └── "Unassigned" lane (orphans for the current lane mode)
│
├── Lane-kanban (/w/{ws}/lane/{kind}/{id})  ← NEW
│   ├── Top strip: lane label + dates/owner/component meta + "View on roadmap"
│   ├── 5 fixed columns by status_kind + optional Unmapped
│   ├── Cards = predicate match (e.g. parent_card_id=id, or assignee=userId)
│   └── Drag tile → ensure status list exists on tile's home board → move card
│
├── Boards page (/w/{ws}/boards)  ← previous workspace landing
│   └── Existing board grid
│
├── Single board kanban (/b/{boardId})  ← unchanged
└── Backlog / Versions / Dashboards / Inbox / Card modal — unchanged
```

**Lane kinds (v1):**
- `epic` — `id` = epic card uuid; predicate: `parent_card_id = id`
- `assignee` — `id` = user uuid; predicate: card has `card_members` row with that user
- `component` — `id` = component uuid; predicate: card has `card_components` row with that component
- `orphan` — `id` = `current` (sentinel); predicate: depends on the originating lane mode (no epic / no assignee / no component)

**Top-nav order:** ROADMAP · BOARDS · BACKLOG · MY TASKS · VERSIONS.

---

## 4. URL routes

| Route | Purpose | Status |
|---|---|---|
| `/w/{ws}` | Workspace root | **CHANGED** — 307 redirect to roadmap |
| `/w/{ws}/roadmap` | Roadmap landing | extended: every lane title clickable |
| `/w/{ws}/lane/{kind}/{id}` | Lane-kanban | **NEW** — generic 5-column status view |
| `/w/{ws}/boards` | Board grid | **NEW** — moved from workspace root |
| `/b/{boardId}` | Single-board kanban | unchanged |
| `/b/{boardId}/c/{cardId}` | Card modal | unchanged |

---

## 5. Data model

**Zero new tables. One trigger drop.**

### Migration `0052_drop_epic_co_locate.sql`

The `cards_co_locate_with_epic_parent_biu` trigger from `0051` is no longer correct under this model — children may legitimately live on different boards from the epic-parent. Drop it.

```sql
drop trigger if exists cards_co_locate_with_epic_parent_biu on public.cards;
drop function if exists public.cards_co_locate_with_epic_parent();
```

**Keep from 0051:**
- `cards_validate_epic_parent_biu` (Q10 — single-level epics)
- `cards_reject_epic_with_epic_children_bu` (type-flip protection)

### Lane predicate helpers (TypeScript-only, not SQL)

```ts
type LaneKind = "epic" | "assignee" | "component" | "orphan";
type LanePredicate =
  | { kind: "epic"; id: string }
  | { kind: "assignee"; id: string }
  | { kind: "component"; id: string }
  | { kind: "orphan"; basis: "epic" | "assignee" | "component" };
```

`lib/queries/lane-cards.ts` returns the matching cards + the lists for the boards those cards span.

### `ensureStatusListImpl` action

Idempotent server action: given `(boardId, statusKind)`, return the first list on that board with `status_kind = statusKind`. If none exists, create a new list named after the status (`Todo`, `In progress`, …) at end-of-board.

### `moveCardToStatus` helper

Wraps `ensureStatusListImpl` + a position update on `cards`. Single transaction. The target board is the **card's current** `board_id`, not anything epic-specific.

---

## 6. Components / UI surfaces

| Component | Action | Notes |
|---|---|---|
| `app/(app)/w/[wsId]/page.tsx` | REPLACE — 307 redirect | → `/w/{ws}/roadmap` |
| `app/(app)/w/[wsId]/boards/page.tsx` | NEW | Houses the previous workspace home board grid |
| `app/(app)/w/[wsId]/lane/[kind]/[id]/page.tsx` | NEW | Server component fetching predicate-matched cards + lists |
| `components/lane/lane-kanban-view.tsx` | NEW | 5-column kanban driven by status_kind, generic over lane kind |
| `components/lane/lane-header.tsx` | NEW | Renders label + meta (epic dates / assignee profile / component) |
| `components/lane/lane-status-column.tsx` | NEW | Droppable status column, sortable tiles |
| `components/roadmap/roadmap-view.tsx` | EXTEND | Every lane title becomes a `<Link>` to `/lane/{kind}/{id}` |
| `components/board/card-modal.tsx` | EXTEND | When `card.type === 'epic'`, show "Open epic kanban" CTA → epic lane URL |
| `components/nav/top-nav.tsx` | EXTEND | Reorder; add BOARDS link |
| `actions/lists.ts` | NEW `ensureStatusListImpl` | Atomic create-if-missing |
| `actions/cards.ts` | NEW `moveCardToStatusImpl` | Wraps ensureStatusList + positional move |
| `lib/queries/lane-cards.ts` | NEW | `listLaneCards(token, predicate)` returns cards + lists |
| `lib/lane/group-cards-by-status.ts` | NEW | Pure helper, groups by status_kind, sorts by position |
| `lib/lane/predicate.ts` | NEW | Parse / serialize / match `LanePredicate` |
| `hooks/use-workspace-realtime.ts` | REUSE (no change) | Existing workspace-scope cards subscription covers all lane kinds |

**Drag-drop in lane-kanban:** PointerSensor distance 8px (matches board view). On drop:
1. Optimistic local store update (card's `listId`).
2. `moveCardToStatus({ cardId, statusKind })` server action:
   1. `ensureStatusListImpl(card.boardId, statusKind)` → target list on the **card's own** board.
   2. Position-aware update of `cards.list_id` + `cards.position`.
3. CDC echo via `useWorkspaceRealtime`.

**Realtime:** lane-kanban reuses the workspace channel. Cards from the predicate are filtered client-side. No new subscription.

---

## 7. Existing data migration

Zero forced migration. Day-1 functional:

| Data | Behavior |
|---|---|
| Existing boards | Untouched. Visible in `/w/{ws}/boards`. |
| Existing cards `type='epic'` | Each becomes a clickable lane on the roadmap. Lane-kanban shows direct children grouped by status. |
| Existing children of epics on different boards | **Stay where they are.** No backfill needed. Lane-kanban surfaces them grouped; drag works per-board. |
| Existing epic-of-epic violations (if any) | Pre-deploy `0053` clears the offending parent_card_id. Banner: "N epic cards had their epic-parent cleared." |
| Lists without `status_kind` | Cards fall into the "Unmapped" sixth column. UI prompt to map. |
| Cards matching no current lane mode | Show in roadmap "Unassigned" lane. |

### Migration `0053_clear_nested_epic_parents.sql`

```sql
do $$
declare affected int;
begin
  with cleared as (
    update public.cards c
    set parent_card_id = null
    from public.cards p
    where c.parent_card_id = p.id and c.type = 'epic' and p.type = 'epic'
    returning c.id
  )
  select count(*) into affected from cleared;
  if affected > 0 then
    raise notice 'lane-as-kanban: cleared parent_card_id on % epic cards', affected;
  end if;
end$$;
```

---

## 8. Edge cases

| Case | Behavior |
|---|---|
| Lane with zero cards | Empty 5-column kanban. CTA: open the lane's natural source (epic modal, assignee profile, component panel). |
| Card's predicate state changes mid-flight | Realtime echo updates lane-kanban filter; card visibly enters/leaves columns. |
| Drag a card whose home board has no status_kind list | `ensureStatusListImpl` creates one (matches existing pattern). |
| Multi-tab cross-context drag | CDC echo reconciles. |
| Card archived during drag | Optimistic move applies, server returns 0 rows, realtime rolls back. |
| Workspace with zero epics | Lane mode picker still offers assignee + component. Roadmap shows assignee-grouped lanes by default. |
| Workspace with 200+ cards in one lane | First-cut: render all. Revisit virtualization if perf flags. |
| Subtask in lane-kanban | Hidden from default lane-kanban view (Q4 — direct match only). Visible inside the parent's modal. |
| Light theme | Status colors flip via existing `--status-*` tokens. |
| Demo seed | `actions/seed.ts` Demo Workspace creates 1 epic + 4 children + named assignee. Lane-kanban for that epic works out of the box. |

---

## 9. Testing

| Layer | Coverage |
|---|---|
| **Unit** | `lib/lane/group-cards-by-status.ts` — 5 cases (empty, all-todo, mixed, unmapped list, missing list ref). `lib/lane/predicate.ts` — 4 cases (parse + match for each kind). |
| **Integration** | `tests/integration/lane-cards.test.ts` — 5 scenarios: epic predicate returns direct children only; assignee predicate returns membership matches; component predicate; orphan predicate; cross-board span returns lists from all relevant boards. `tests/integration/move-card-to-status.test.ts` — `ensureStatusListImpl` idempotency + creates missing; `moveCardToStatusImpl` moves card on its own board; non-board-member rejected by RLS. |
| **E2E** | `tests/e2e/lane-kanban.spec.ts` — signup → roadmap landing → click an epic lane → drag card from todo to done → reload → assert persistence. ~1 spec, 6 assertions. |
| **Regression** | Existing 152+ unit + 10 E2E stay green. Roadmap E2E extended for "Unassigned" lane assertion + lane-title-clickable assertion. |

---

## 10. Out of scope (deferred)

- Nested epics.
- Per-lane customizable columns.
- `cards.status` decoupled from `list_id`.
- Cross-board DnD inside a lane-kanban.
- Lane-kanban swimlanes within columns.
- Sprint-as-lane (predicate exists but the lane mode is future).
- Label-as-lane.
- Bulk-move lane membership.
- "Promote to epic" bulk action.

---

## 11. Definition of done

- Visiting `/w/{ws}` 307s to `/w/{ws}/roadmap`.
- Top-nav exposes BOARDS link → `/w/{ws}/boards`.
- Every lane title on the roadmap is a clickable link routing to `/w/{ws}/lane/{kind}/{id}`.
- Lane-kanban renders 5 columns + optional Unmapped column.
- Dragging a card across columns updates `cards.list_id` to a list with the matching `status_kind` on the **card's own** board, auto-creating the list if missing.
- Status changes propagate via realtime to other open clients.
- Roadmap shows "Unassigned" lane for cards matching no predicate.
- Setting an epic's `parent_card_id` to another epic remains rejected (trigger from 0051, unchanged).
- The 0051 co-locate trigger is dropped (0052) so children can legitimately live on different boards from their epic.
- All vitest + Playwright tests green; new tests added per §9.
