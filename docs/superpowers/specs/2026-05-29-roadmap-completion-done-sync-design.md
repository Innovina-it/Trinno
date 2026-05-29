# Roadmap completion ↔ board "done" sync

**Date:** 2026-05-29
**Status:** Design — approved by user, pending spec review

## Problem

In the roadmap (Gantt) view, ticking a card's complete checkbox sets `cards.completedAt`
but leaves the card in whatever list it was in. The user wants the card's **board status**
to follow:

1. Tick complete on the roadmap → the card moves to the board's **done** list
   (a list with `status_kind = 'done'`). If the board has no done list, create one.
2. Un-tick complete on the roadmap → the card returns to the **exact list it was in
   before** the auto-move to done.

Scope is the **roadmap complete toggle only**. The five board-side completion toggles
(card modal, card tile, complete-toggle component, due section, bulk) keep their current
behavior — completing there does NOT move the card.

## Current state (as explored)

- A card **is** a Gantt task — same `cards` row. Completion = `cards.completedAt` timestamp.
- Board card status = which list the card lives in. A "done" list is `lists.status_kind = 'done'`
  (enum `'todo' | 'in_progress' | 'review' | 'done' | 'blocked'`).
- `updateCardImpl` sets `completedAt` but **never touches `listId`** (explicit invariant,
  `actions/cards.ts:320`, `#0111`). `updateCard({ completed })` is called from 6 places,
  only one of which is the roadmap bar (`components/roadmap/roadmap-bar.tsx:309`).
- `moveCardToStatusImpl(token, { cardId, statusKind })` (`actions/cards.ts:559`) already:
  resolves/creates the target-status list (`ensureStatusListImpl`), no-ops if the card is
  already in that status, and gates guests on `["listId"]`.
- `moveCardImpl(token, { cardId, toListId, beforeCardId? })` (`actions/cards.ts:959`) moves
  a card to a specific list.
- No previous-list field exists. List moves are logged in `card_field_history`
  (migration 0113) but that audit is not a reliable revert source.
- Precedent for linking completion + done-list move: subtask→parent sync
  (`syncParentFromSubtaskImpl`, `actions/cards.ts:1262`) sets `completedAt` then calls
  `moveCardToStatusImpl('done')`.

## Decisions (from the user)

| Question | Decision |
|---|---|
| Scope | Roadmap complete toggle only; board toggles unchanged |
| Board has no done list on complete | Create a done list and move there |
| On un-complete | Return to the exact prior list; if we never moved it, leave it |
| Prior-list tracking | Persist (un-complete can happen later / another device) |

## Architecture — Approach A: dedicated server action

`updateCard` stays pure (never touches `listId`). A new action composes existing,
already-authorized primitives.

### 1. Data model

New nullable column on `cards`:

```sql
ALTER TABLE public.cards
  ADD COLUMN pre_done_list_id uuid
  REFERENCES public.lists(id) ON DELETE SET NULL;
```

Holds the list the card sat in immediately before the roadmap auto-moved it to done.
`ON DELETE SET NULL` makes "prior list deleted while card is completed" safe — the revert
target vanishes and the card simply stays in done.

- New migration file: next sequential number in `supabase/migrations/`.
- Add the column to the Drizzle schema (`lib/db/schema.ts`) and regenerate types.

### 2. New server action `setRoadmapCompletion(token, { cardId, completed })`

**Completing (`completed: true`):**

1. Read the card's current `listId` and that list's `status_kind`.
2. If the current list is **not** `done`:
   - Set `pre_done_list_id = current listId`.
   - Call `moveCardToStatusImpl(token, { cardId, statusKind: 'done' })`
     (auto-creates the done list if missing; no-ops if already done).
3. Set `completedAt = now()`.

If the current list **is** already `done`: do not move, leave `pre_done_list_id` null
(so a later un-complete won't move it).

**Un-completing (`completed: false`):**

1. Set `completedAt = null`.
2. Revert **only if** the card is *currently in a done list* AND `pre_done_list_id` is
   set and still exists:
   - `moveCardImpl(token, { cardId, toListId: pre_done_list_id })`
   - Clear `pre_done_list_id` (set null).
3. Otherwise (pointer null, prior list deleted, or user manually moved the card out of
   done after completing) → leave the card where it is; clear `pre_done_list_id` if set.

Guard rationale for step 2: if the user manually dragged the card to another list after
completing it, un-completing must not override their manual placement.

Authorization: list moves go through `moveCardToStatusImpl` / `moveCardImpl`, which already
enforce guest gating on `["listId"]`. The `completedAt` write follows the same path
`updateCardImpl` uses for completion.

### 3. Client wiring

`components/roadmap/roadmap-bar.tsx` `handleToggleComplete` (line 309) calls
`setRoadmapCompletion({ cardId: card.id, completed: next })` instead of
`updateCard({ id, completed: next })`.

- Keep the optimistic `patchCardLocal({ completedAt, dueComplete })` so the bar's
  complete visual (green ring / strikethrough) flips instantly.
- The card's `listId` change (and therefore bar fill color) reconciles via realtime CDC —
  same pattern the bar already relies on. No separate optimistic listId patch needed.
- On error, roll back the optimistic patch (existing logic).

## Edge cases

| Case | Behavior |
|---|---|
| Card already in a done list when completed | No move; `pre_done_list_id` stays null; un-complete leaves it. |
| Board has no done list | `moveCardToStatusImpl` creates one. |
| Prior list deleted before un-complete | FK nulls `pre_done_list_id`; card stays in done. |
| User manually moves card out of done while completed, then un-completes | No yank-back; pointer cleared. |
| Board has multiple `done` lists | `moveCardToStatusImpl` resolves/creates one deterministically — acceptable. |
| Guest user | Gated by existing `["listId"]` checks in the move impls. |

## Testing

Integration tests in `tests/integration/` mirroring `epic-actions.test.ts` style:

1. Complete on roadmap → card moves to done list, `pre_done_list_id` records prior list.
2. Un-complete → card returns to prior list, `pre_done_list_id` cleared, `completedAt` null.
3. No done list on board → done list created, card moved.
4. Card already in done when completed → `pre_done_list_id` stays null; un-complete is a no-op move.
5. Manual move out of done while completed, then un-complete → card stays put, no revert.
6. Prior list deleted before un-complete → card stays in done (FK nulled).
7. Board-side completion toggle (card modal/tile) → no list move (scope guard).

## Out of scope (YAGNI)

- Reverse direction (moving a card into/out of a done list on the board → toggle
  `completedAt`). Not requested.
- Applying the link to the five non-roadmap completion toggles.
