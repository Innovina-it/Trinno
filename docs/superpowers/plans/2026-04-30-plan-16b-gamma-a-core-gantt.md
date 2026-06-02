# Plan #16b-γ-A — Core Gantt (status mapping, critical path, cascade, E2E)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Scope:** 4 items from γ. Order: status mapping (foundation) → critical path → cascade → integration E2E.

## Tasks

### Task 1 — `lists.status_kind` mapping

`supabase/migrations/0036_list_status.sql`:
```sql
create type public.list_status_kind as enum ('todo','in_progress','review','done','blocked');

alter table public.lists
  add column status_kind public.list_status_kind;
create index on public.lists (board_id, status_kind);
```

Drizzle: append `statusKind: listStatusKind("status_kind")` to `lists` table; export `listStatusKind = pgEnum(...)`.

Validation: `SetListStatusKindInput = z.object({ id: Uuid, statusKind: z.enum([...]).nullable() })`.

Action: append `setListStatusKindImpl` + wrapper to `actions/lists.ts`. Standard impl/wrapper pattern.

`useBoardRealtime` `rowToList` mapper: include `statusKind: r.status_kind ?? null`.

`ListsAdminPanel` (board settings): for each list, render a small dropdown next to the WIP setter — Status: `unmapped / todo / in progress / review / done / blocked`. Save on change.

Apply migration + restart kong. Existing tests stay green.

Commit: `feat(lists): status_kind enum + admin panel mapping`.

### Task 2 — Roadmap bar fill by status

Each card on the roadmap inherits status from its current `list_id`'s `statusKind`. Add a helper `getCardStatusKind(card, lists): StatusKind | null` in `lib/roadmap/status.ts`.

Modify `components/roadmap/roadmap-bar.tsx`:
- `todo`: flat fill `bg-fg/15`.
- `in_progress`: solid `bg-fg/40` + tiny `animate-pulse` ring.
- `review`: diagonal hatch — use repeating-linear-gradient `repeating-linear-gradient(45deg, rgb(255 255 255 / 0.2) 0 4px, transparent 4px 8px)`.
- `done`: striped — `repeating-linear-gradient(0deg, rgb(255 255 255 / 0.3) 0 2px, transparent 2px 6px)`.
- `blocked`: red-ringed `ring-2 ring-red-500/60` (only chroma allowed).
- unmapped (null): existing default fill.

Tooltip on hover shows the status kind text in the bar's `title` attribute.

Commit: `feat(roadmap): bar fill style by list status kind`.

### Task 3 — Critical-path overlay

`lib/roadmap/critical-path.ts`:

```ts
export type CardWithDates = { id: string; startDate: Date | null; targetDate: Date | null };
export type Link = { from: string; to: string; kind: string };

// Build adjacency: from blocked → blocker  (i.e. card.is_blocked_by points to blocker)
// We model arrows: blocker → blocked, then find longest path through this DAG.
export function criticalPath(
  cards: CardWithDates[],
  links: Link[],
): { critical: Set<string>; longestDays: number } {
  // Use only "is_blocked_by" links as edges blocker → blocked
  // links payload: from = blocked, to = blocker (per realtime data) — invert.
  // Or: spec says is_blocked_by means from is blocked by to. We want edges to → from.
  // ...
  // Topo sort, compute longest path by duration of each node (target - start in days).
  // Mark all nodes on a longest path.
}
```

Component `components/roadmap/critical-path-overlay.tsx`:
- Takes `bars: { id, top, left, width }[]` from `RoadmapView` (lift via prop or refs map).
- Renders a thicker outline `outline outline-2 outline-fg/70` on critical bars.
- Optional small dot at right edge of each critical bar.

Toggle in `RoadmapView` header: "Show critical path" — local state only.

Add 3 unit tests in `tests/unit/critical-path.test.ts`:
- empty → empty
- single chain A→B→C → all 3 critical
- branch where one path is longer → only longer chain

Commit: `feat(roadmap): critical-path overlay with longest-path topo sort + 3 unit tests`.

### Task 4 — Cascade shift on cross-blocker drag

`actions/cards.ts`:

```ts
export async function cascadeShiftBlockedAfterImpl(
  token: string,
  input: { cardId: string; deltaDays: number },
): Promise<{ shifted: { id: string; deltaDays: number }[] }> {
  const parsed = z.object({ cardId: Uuid, deltaDays: z.number().int().min(-365).max(365) }).parse(input);
  return dbAsUser(token, async (tx) => {
    // Recursively gather all cards transitively blocked by parsed.cardId
    // via card_links of kind 'is_blocked_by' (where to=parsed.cardId, traverse from)
    // Cap depth 50 to prevent runaway.
    // Update each card's start_date + target_date += deltaDays.
    // Return list of shifted ids.
  });
}
```

Validation: `CascadeShiftBlockedInput = z.object({ cardId: Uuid, deltaDays: z.number().int().min(-365).max(365) })`.

UI in `components/roadmap/roadmap-view.tsx`:
- Add toggle in header "Auto-reschedule blocked dependents" (`autoCascade` state, default off, persist in localStorage).
- After a drag commits target_date update successfully:
  - Compute set of cards transitively blocked by this card (use already-loaded `links` in store).
  - For each blocked card whose `start_date < newTargetDate`, propose shift.
  - If there's anything to shift AND `autoCascade === true`: open a confirmation dialog with count + shifted preview.
  - On confirm: call `cascadeShiftBlockedAfter({cardId, deltaDays})`. Optimistic local store updates.
  - On cancel: do nothing (the original drag already persisted; only dependents affected).

Cap UX preview at 20 cards displayed; "+ N more" if truncated.

Add `tests/integration/cascade-shift.test.ts`:
- Setup: A blocks B (A target=Jun 1, B start=Jun 5). Drag A target +10d → B start should shift by 10 if autoCascade-style call invoked.
- Assert direct DB rows.

Commit: `feat(roadmap): cascadeShiftBlockedAfter action + auto-reschedule toggle + dialog + integration test`.

### Task 5 — Integration E2E

`tests/e2e/jira-gantt-integration.spec.ts`:
- Sign up, create workspace, board.
- Create epic with start_date + target_date set via card modal RoadmapDatesSection.
- Create story B blocked by epic via card-links section.
- Navigate to roadmap. Both bars visible. Dependency arrow rendered.
- Drag epic's right edge +14 days. Reload — persisted.
- Toggle "Show critical path" → epic + B both outlined.
- Open second context (browser.newContext()): same workspace, navigate to roadmap, see updated dates.
- Modify B's title via modal in context A. In context B, observe title update on bar's tooltip within 3s.
- Verify activity feed contains `card.dates` event from the drag (will become visible once α #1 lands; for now, accept the activity row appearing as `card.move` or `card.due` if α not yet shipped — adapt selector).

Commit: `test(e2e): jira-gantt integration — drag, critical path, cascade, cross-context realtime`.

### Task 6 — Final verification

- `npx tsc --noEmit` clean.
- `npm run build` clean.
- `npm run test:unit` — 127 + new tests = ~131 expected.
- `npx playwright test` — 9 + 1 = 10 expected.

## Constraints

- Preserve all existing testids / accessible names.
- No new deps. SVG inline + Tailwind only.
- Critical path uses only `is_blocked_by` links (one direction); ignore `relates_to` / `duplicates` for now.
- Cascade depth capped at 50; cycle protection via `visited` set.

## Self-Review Notes

- **Status fill design choice**: hatch + stripe + ring patterns use only white at varying opacity, plus a single red ring for blocked. Matches monochrome rule.
- **Critical path runs client-side**: compact since cards are already loaded; topo+longest is O(V+E).
- **Cascade is opt-in**: never silently shifts user's dependent cards.
- **Out of scope for γ-A**: cards.priority field (γ-C #25), favorites (γ-C #29), undo (γ-D #10).
