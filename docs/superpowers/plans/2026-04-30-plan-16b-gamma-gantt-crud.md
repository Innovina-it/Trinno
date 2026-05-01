# Plan #16b-γ-Gantt-CRUD — Gantt usability + CRUD + Kanban consistency

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Scope:** Close the usability + CRUD gaps surfaced in the previous audit. Make the Gantt feel as interactive as the Kanban — left-click opens modal, search, quick-add, inline overflow menu, archive, filter parity, keyboard shortcuts, hover tooltip, epic-row link.

**Out of scope:** Bulk-select on the Gantt (separate slice). Inline date input on hover (rejected for now — drag is the primary affordance). Roadmap virtualization (deferred until cards > 200 in practice).

**Depends on:** plan #13 (roadmap), plan #16b-α (URL focus, schedule chip), plan #16b-β (workspace store), plan #16b-γ-A (critical path), plan #16b-γ-C (priority/cover/empty states). All shipped.

---

## Tasks

### Task 1 — Click-to-open-modal on bar (15 min)

`components/roadmap/roadmap-bar.tsx`: add `onClick` handler that pushes `/b/{boardId}/c/{cardId}` (Next.js intercepted route handles the modal).

Guard: do NOT navigate when a drag was just released — track `wasDragged` in component state, set `true` on `pointermove` past 4px, reset on next idle. If `wasDragged && Date.now() - lastDragEnd < 250` → preventDefault.

Right-click context menu stays.

Commit: `feat(roadmap): left-click bar opens card modal (with drag suppression)`.

### Task 2 — Hover overflow button on bar (45 min)

Render a small chevron-down icon in the top-right of the bar, visible on hover only (`opacity-0 group-hover/bar:opacity-100`). Click → small dropdown menu with:
- "Open card" (modal — same as left-click)
- "Open in board" (full board navigation)
- "Edit dates…" (opens a tiny inline form with two `<input type="date">` inputs + Save)
- "Archive card" (calls `archiveCard` action + writes to `undoBus`)

Use base-ui `DropdownMenu`. Position with portal to escape the bar's overflow:hidden.

Commit: `feat(roadmap): hover overflow menu — open card/in board/edit dates/archive`.

### Task 3 — Search input in roadmap header (30 min)

Add `<Input>` next to existing zoom toggle in the roadmap header. Debounced 200ms. Filters bars by `title.toLowerCase().includes(q)` client-side. Empty state text in lane area: "No bars match `<q>`. Clear search."

Search state lives in URL (`?q=`) so it's shareable. `useSearchParams` reads, `useRouter.replace` writes.

When q is set, dependency-arrows hide for cards filtered out. Critical-path overlay too — recompute against visible set.

Commit: `feat(roadmap): URL-state search input — filter bars by title`.

### Task 4 — Quick-add bar (1 hr)

Top-right of roadmap header: "+ New card" button. Opens a dialog (base-ui `Dialog`):

Form fields:
- Board (dropdown, lists user's boards in workspace via `useWorkspaceStore`)
- List (dropdown, lists active board's lists via Drizzle query — fetch on board change OR seed from store)
- Title (Input, required, max 120)
- Start date (date input, optional)
- Target date (date input, optional)

On submit: calls `createCard({ listId, title })` then if dates set, follows up with `updateCard({ id, startDate, targetDate })`. Returns to roadmap focused on new card via `?focus=newId`.

Commit: `feat(roadmap): + New card dialog — pick board/list, title, optional dates`.

### Task 5 — Bar tooltip with metadata (45 min)

Hover bar 500ms → small floating popover (positioned absolutely above bar). Renders:
- Card title (full, no truncate)
- Type icon + priority chip + story-points chip
- Assignees (small avatar stack from `cardMembers` + `boardProfiles`)
- Status (from list.statusKind if mapped, else "—")
- Sprint name (resolve from `useWorkspaceStore.sprints`)

Use `setTimeout` with cleanup on unhover. Don't show during drag.

Commit: `feat(roadmap): hover tooltip with title/type/priority/sp/assignees/status/sprint`.

### Task 6 — Filter bar parity (1.5 hrs)

Lift `BoardFilterBar`'s controls into a shared `FilterChips` component (or extract from `board-filter-bar.tsx`). Render in roadmap header below the zoom/search row. Available chips:
- Members (avatar dropdown from `boardProfiles` across all boards)
- Labels (chip dropdown from union of board labels)
- Type (epic/story/task/subtask/bug)
- Sprint (active + planned)
- Scheduled (already implicit on roadmap; show "Show unscheduled" toggle instead)
- Overdue
- Assigned to me

URL-state: same `parseFilters` as Kanban; key=value in query string. Filter is `applyFilters` from `lib/board-filters.ts` — works on the `cards` array client-side.

Commit: `refactor(filters): extract FilterChips; mount on roadmap header`.

### Task 7 — Keyboard shortcuts (1 hr)

`useEffect` in `RoadmapView`:
- `/` → focus search input (preventDefault if not in another input)
- `Esc` → clear search + selection
- `←` / `→` → pan day ±1 (or ±7 with Shift)
- `+` / `-` → zoom level cycle (week→month→quarter)
- `n` → open Quick-add dialog
- `?` → show help modal listing shortcuts

Use `KeyboardEvent.target` check to avoid intercepting input fields.

Commit: `feat(roadmap): keyboard shortcuts (/, Esc, arrows, +/-, n, ?)`.

### Task 8 — Epic-lane row title link (15 min)

Currently lane header shows epic title text. Wrap in a button that pushes `/b/{epicBoardId}/c/{epicId}` on click. Tooltip: "Open epic card".

Commit: `feat(roadmap): epic lane title links to epic card modal`.

### Task 9 — Final verification (30 min)

- `npx tsc --noEmit` clean
- `npm run build` clean
- `npm run test:unit` (no new unit tests in this slice)
- `npx playwright test` (existing suites still pass)
- Manual smoke: left-click bar → modal opens, hover bar → overflow menu, type in search → bars filter, `+` → dialog, archive → undo banner.

---

## Files

**Modified:**
- `components/roadmap/roadmap-view.tsx` — header expanded with search + filters + new-card button + keyboard shortcuts + epic-link
- `components/roadmap/roadmap-bar.tsx` — onClick + overflow chevron + tooltip + drag-suppression
- `lib/board-filters.ts` — exported `FilterChips` (or new file `components/board/filter-chips.tsx`)

**New:**
- `components/roadmap/roadmap-search.tsx`
- `components/roadmap/roadmap-quick-add-dialog.tsx`
- `components/roadmap/bar-tooltip.tsx`
- `components/roadmap/keyboard-shortcuts.tsx` (or inline in roadmap-view)

**No new migrations.**

---

## Constraints

- Preserve `data-testid`s + accessible names. Add: `bar-overflow-menu`, `roadmap-search`, `roadmap-quick-add`, `bar-tooltip`.
- No new deps. Use `lucide-react` icons.
- Mono palette intact.
- All edits via existing actions (`createCard`, `updateCard`, `archiveCard`).

---

## Self-Review Notes

- **Drag-vs-click**: PointerSensor doesn't apply to Roadmap (it uses raw pointer events). Manual `wasDragged` flag is the right call.
- **Search recompute cost**: client-side string match over ≤200 cards = trivial.
- **Quick-add**: requires fetching lists for the chosen board. If `useWorkspaceStore` doesn't expose lists across boards, fetch via Drizzle once on board pick.
- **Filter parity**: `BoardFilterBar` reads board store. `useWorkspaceStore` has cards but not labels/profiles per-board. May need to load union of all board labels server-side once and pass as prop. Keep simple: filter chips that need cross-board data hide their dropdowns until store is extended.
- **Keyboard shortcuts** must not break existing inline form focus on Kanban. Roadmap-only; mounted only when `RoadmapView` is the active page.
