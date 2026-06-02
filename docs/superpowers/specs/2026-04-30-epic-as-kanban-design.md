# Roadmap-First with Epic-as-Kanban — Design Specification

**Date:** 2026-04-30
**Status:** Approved for implementation planning
**Scope:** Invert workspace mental model. Roadmap becomes the primary working surface. Each epic card owns a kanban view that surfaces direct children grouped by status_kind. Boards remain available but are demoted from the workspace landing page.

---

## 1. Goals & Non-Goals

### Goals

- Make the roadmap the workspace's default landing page.
- Give every epic its own clickable kanban view, accessed from the roadmap.
- Present epic-kanban columns as the five fixed `status_kind` values (`todo` / `in_progress` / `review` / `done` / `blocked`).
- Show direct children of the epic (stories, tasks, bugs, subtasks) grouped by status, with full drag-drop semantics.
- Surface orphan cards (no epic parent) in an "Unassigned" lane on the roadmap so they remain visible without forcing migration.
- Achieve all of the above with zero new tables and minimal schema friction.

### Non-Goals

- Nested epics (epic-of-epic) — deferred.
- Per-epic customizable columns — fixed 5 columns for v1.
- Decoupling `cards.status` from `list_id` — list_id remains the single source of truth.
- Cross-view DnD (drag a card from a roadmap bar directly into a status column) — deferred.
- Cross-workspace epic-kanbans — workspace-scoped only.

---

## 2. Decision log

| # | Decision | Choice | Rationale |
|---|---|---|---|
| Q1 | Which cards own a kanban? | Epic only (`type='epic'`). | Other types stay leaves on the roadmap; epic is the unit of organisation. |
| Q2 | Relationship to existing boards? | Coexist. Boards survive, demoted from landing. | Zero migration risk. Free-floating boards still useful. |
| Q3 | Data model for epic-kanban | Synthetic view, no new tables. Group cards `WHERE parent_card_id = epic.id` by `lists.status_kind`. | Reuses status_kind shipped in γ-A. No schema churn. |
| Q4 | Descendant depth in epic-kanban | Direct children only. | Mixing story-sized and subtask-sized items in one column kills scannability. Subtasks already live nested inside the story modal. |
| Q5 | Cards with no epic parent | "Unassigned" lane on roadmap. | Lowest friction. No forced migration. |
| Q6 | Navigation from roadmap to epic-kanban | Full-page route `/w/{ws}/e/{epicId}`. | Predictable, deep-linkable, no nested-overlay complexity. |
| Q7 | Epic-kanban columns | Fixed 5 status_kind. | Consistent app-wide. Reuses γ-A status mapping. |
| Q8 | Drag updates which `list_id`? | Epic's home board, first list with matching status_kind. Auto-create if missing. | Keeps single-source-of-truth on `list_id`. Auto-create avoids manual setup. |
| Q9 | Child-card board co-location | Auto co-locate child to epic's home board on parent set. | Single-board-per-epic-tree mental model. |
| Q10 | Nested epics? | No. Single-level only. CHECK constraint enforces it. | Mirrors Jira's epic-story-task. Avoids recursive complexity. |
| Q11 | What appears on the roadmap? | Epics expanded by default + Unassigned lane. Children with dates render as nested rows. | Roadmap doubles as calendar (date planning) and portal (click into epic-kanban for status). |
| Q12 | Workspace landing | Roadmap. `/w/{ws}` 307s to `/w/{ws}/roadmap`. Boards page accessible via top nav. | User said "roadmap is the main working place." |

---

## 3. Architecture

```
Workspace
├── Roadmap (/w/{ws}/roadmap) ← LANDING (307 redirect from /w/{ws})
│   ├── Epic lanes (expanded by default, sortable, draggable date bars)
│   │   └── Children w/ dates as nested rows (current Gantt behavior)
│   └── "Unassigned" lane (orphan cards w/ no epic parent)
│
├── Epic-kanban (/w/{ws}/e/{epicId})  ← NEW page
│   ├── Top strip: epic title + dates + progress + "View on roadmap" link
│   ├── 5 fixed columns by status_kind: Todo / In progress / Review / Done / Blocked
│   ├── Optional 6th "Unmapped" column when child cards live in lists with no status_kind
│   ├── Cards = direct children of epic (parent_card_id = epicId)
│   └── Drag tile → ensure status list exists on epic's home board, then move card
│
├── Boards page (/w/{ws}/boards)  ← NEW path (was workspace landing)
│   └── Existing board grid, unchanged
│
├── Single board kanban (/b/{boardId})  ← unchanged
└── Backlog / Versions / Dashboards / Inbox / Card modal — all unchanged
```

**Top-nav order:** ROADMAP · BOARDS · BACKLOG · VERSIONS · DASHBOARDS · INBOX.

---

## 4. URL routes

| Route | Purpose | Status |
|---|---|---|
| `/w/{ws}` | Workspace root | **CHANGED** — 307 redirect to roadmap (was: board grid) |
| `/w/{ws}/roadmap` | Roadmap landing | extended: render Unassigned lane + click-through epic bars |
| `/w/{ws}/e/{epicId}` | Epic-kanban | **NEW** — 5-column status view |
| `/w/{ws}/boards` | Board grid | **NEW** — accessible via nav |
| `/b/{boardId}` | Single-board kanban | unchanged |
| `/b/{boardId}/c/{cardId}` | Card modal | unchanged |

---

## 5. Data model

**Zero new tables.** Two BEFORE INSERT/UPDATE triggers and a one-shot migration.

### Migration `0046_epic_constraints.sql`

```sql
-- Q10: single-level epics. Epic cannot have an epic as parent.
create or replace function public.cards_validate_epic_parent()
returns trigger language plpgsql as $$
declare
  parent_type text;
begin
  if new.parent_card_id is null then return new; end if;
  select type into parent_type from public.cards where id = new.parent_card_id;
  if new.type = 'epic' and parent_type = 'epic' then
    raise exception 'cards: epic cannot have an epic as parent';
  end if;
  return new;
end;
$$;

create trigger cards_validate_epic_parent_biu
  before insert or update of parent_card_id, type on public.cards
  for each row execute function public.cards_validate_epic_parent();

-- Q9: auto co-locate child onto epic's home board on parent set.
create or replace function public.cards_co_locate_with_epic_parent()
returns trigger language plpgsql as $$
declare
  parent_board uuid;
  parent_type text;
begin
  if new.parent_card_id is null then return new; end if;
  select board_id, type into parent_board, parent_type
  from public.cards where id = new.parent_card_id;
  if parent_type = 'epic' and new.board_id <> parent_board then
    new.board_id := parent_board;
  end if;
  return new;
end;
$$;

create trigger cards_co_locate_with_epic_parent_biu
  before insert or update of parent_card_id on public.cards
  for each row execute function public.cards_co_locate_with_epic_parent();
```

### Migration `0047_co_locate_existing_children.sql` (one-shot)

Migrate existing cross-board children of epics onto the epic's board.

```sql
update public.cards c
set board_id = p.board_id
from public.cards p
where c.parent_card_id = p.id
  and p.type = 'epic'
  and c.board_id <> p.board_id;
```

### `status_kind` derivation (client + server)

- Helper already shipped in γ-A: `getCardStatusKind(card, lists)` returns the `status_kind` of the card's current list, or `null` when the list is unmapped.
- Epic-kanban groups direct children by this derived value. Cards with `null` status_kind go into the optional "Unmapped" column rendered in error tone.

### `ensureStatusListImpl` action

Idempotent server action: given `(boardId, statusKind)`, return the first list on that board with `status_kind = statusKind`. If none exists, create a new list named after the status (`Todo`, `In progress`, …) with that status_kind set, position = end of list row.

### `moveCardToStatus` helper

Wraps `ensureStatusListImpl` + `moveCardImpl`. Single transaction. Surfaces server-action errors via the existing `errorBus`.

---

## 6. Components / UI surfaces

| Component | Action | Notes |
|---|---|---|
| `app/(app)/w/[wsId]/page.tsx` | Replace board grid with redirect | 307 → `/w/{ws}/roadmap` |
| `app/(app)/w/[wsId]/boards/page.tsx` | NEW | Houses the previous workspace home board grid |
| `app/(app)/w/[wsId]/e/[epicId]/page.tsx` | NEW | Server component fetching epic + children + lists |
| `components/epic/epic-kanban-view.tsx` | NEW | 5-column kanban driven by status_kind |
| `components/epic/epic-header.tsx` | NEW | Title + dates + progress + "View on roadmap" link |
| `components/roadmap/roadmap-view.tsx` | EXTEND | Epic bars become clickable; add Unassigned lane |
| `components/roadmap/lane-row.tsx` | EXTEND | Lane title row links to `/w/{ws}/e/{epicId}` |
| `components/board/card-modal.tsx` | EXTEND | When card.type === 'epic', show "Open epic kanban" CTA chip |
| `components/nav/top-nav.tsx` | EXTEND | Reorder; add BOARDS link |
| `actions/lists.ts` | NEW `ensureStatusListImpl` | Atomic create-if-missing |
| `actions/cards.ts` | NEW `moveCardToStatus` | Wraps ensureStatusList + moveCard |
| `lib/queries/epic-children.ts` | NEW `listEpicChildren(token, epicId)` | Returns direct children + their lists |
| `hooks/use-workspace-realtime.ts` | REUSE (no change) | Existing workspace-scope `cards` subscription already covers epic children. Epic-kanban filters them client-side via `parent_card_id === epicId`. |
| `lib/epic/group-children-by-status.ts` | NEW | Pure helper, groups children by status_kind, sorted by position |

**Drag-drop in epic-kanban**: PointerSensor distance 8px (matches board view). On drop:
1. Optimistic local store update.
2. `moveCardToStatus({cardId, statusKind})` server action:
   1. `ensureStatusListImpl(epic.boardId, statusKind)` → target list.
   2. `moveCardImpl({id, listId: target.id, position: positionBetween(...)})`.
3. CDC echo confirms via `useWorkspaceRealtime`.

**Realtime**: epic-kanban reuses the existing workspace-scope `cards` channel (`useWorkspaceRealtime`) and filters by `parent_card_id === epicId` client-side. No new Supabase Realtime subscription is opened.

---

## 7. Existing data migration

Zero forced migration. Everything works on day 1.

| Data | Behavior |
|---|---|
| Existing boards (no epic) | Untouched. Visible in `/w/{ws}/boards`. |
| Existing cards `type='epic'` | Become clickable on roadmap. Epic-kanban works for direct children already on same board. |
| Cross-board children of epics | One-shot `0047` migration co-locates them. Idempotent. Trigger keeps it tidy going forward. |
| Existing **epic** cards (`type='epic'`) whose `parent_card_id` points at another epic | Pre-deploy script (`0047b_clear_nested_epic_parents.sql`) sets those `parent_card_id` to NULL. Surfaces post-deploy banner: "N epic cards had their epic-parent cleared (single-level epics enforced)." |
| Lists without `status_kind` on epic-home boards | Cards land in the "Unmapped" sixth column. Inline UI prompt to admin to map status_kind. |
| Cards with no parent epic | Show in roadmap "Unassigned" lane. No data change. |

---

## 8. Edge cases & error handling

| Case | Behavior |
|---|---|
| Epic bar with zero children | Empty 5-column kanban + "+ Add card" per column seeds first child. |
| Story's parent_card_id changes mid-flight | Co-locate trigger moves card to new epic's board. Realtime echoes both old + new epic-kanban views. |
| API attempt to set epic-of-epic | Trigger raises `cards: epic cannot have an epic as parent`. Server action surfaces toast + errorBus. |
| Status-list auto-create RLS denial | `ensureStatusListImpl` throws → toast "Cannot create status column. Ask board admin." |
| Multi-tab cross-context drag | CDC echo reconciles automatically. |
| Card archived during drag | Optimistic move applies, server returns 0 rows, realtime rolls back. |
| Subtask shown on roadmap (Q11=C) AND parent epic expanded | Subtask renders as nested grandchild row; same as today. |
| Workspace with zero epics | Roadmap shows only Unassigned lane. Banner: "Mark a card as Epic to organize work." |
| Epic + children > 200 cards | Existing roadmap cap stays. Epic-kanban has no cap for v1; revisit if needed. |
| Light theme | Status colors flip via existing `--status-*` tokens. |
| Demo seed | `actions/seed.ts` Demo Workspace already creates 1 epic + 4 children. Epic-kanban works on demo data out of the box. |

---

## 9. Testing

| Layer | Coverage |
|---|---|
| **Unit** | `lib/epic/group-children-by-status.ts` — 4 to 6 cases (empty, all-todo, mixed, unmapped list). |
| **Integration** | `tests/integration/epic-kanban.test.ts` — 6 scenarios: trigger rejects epic-of-epic; co-locate trigger moves child board on parent set; `ensureStatusListImpl` is idempotent; `moveCardToStatus` updates list_id correctly + creates missing list; non-board-member drag rejected (RLS); listEpicChildren returns only direct children. |
| **E2E** | `tests/e2e/epic-kanban.spec.ts` — signup → seeded demo epic → roadmap landing → click epic bar → drag card from Todo to Done → assert list moved + status persists on reload → assert activity feed entry. ~1 spec, 6 assertions. |
| **Regression** | Existing 152+ unit + 10 E2E stay green. Roadmap E2E extended for Unassigned lane assertion. |

**Performance budget:** epic-kanban first paint ≤ 400ms (one query: epic + children + lists for epic's board). No new deps. SSR-fetch + client realtime, mirrors plan #16b-β.

---

## 10. Out of scope (deferred)

- Nested epics (epic-of-epic).
- Per-epic customizable columns.
- `cards.status` decoupled from `list_id`.
- Cross-view DnD (roadmap bar → status column).
- Cross-workspace epic-kanbans.
- Bulk-move children between epics.
- Epic-kanban swimlanes (by assignee / component).
- Auto-set due dates from sprint dates.
- "Promote to epic" bulk action.
- Live migration of cross-board children with active CDC drift.

---

## 11. Definition of done

- New visitor lands on `/w/{ws}/roadmap` (not the old board grid).
- Top-nav exposes BOARDS link; clicking it shows the previous board grid at `/w/{ws}/boards`.
- An epic bar on the roadmap is clickable and routes to `/w/{ws}/e/{epicId}`.
- Epic-kanban renders 5 columns (Todo / In progress / Review / Done / Blocked) plus an optional Unmapped column.
- Dragging a card across columns updates `cards.list_id` to a list with the matching `status_kind` on the epic's home board, auto-creating the list if missing.
- Status changes propagate via realtime to other open clients.
- Roadmap shows an Unassigned lane for orphan cards.
- Setting `parent_card_id` to an epic auto-co-locates the child to the epic's board (trigger-enforced).
- Setting `parent_card_id` of an epic to another epic is rejected (trigger-enforced).
- All 152+ vitest tests + 10 E2E specs stay green; new tests added per §9.
