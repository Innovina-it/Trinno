# Mobile + Tablet Responsive Design Spec

**Date:** 2026-05-11
**Register:** product
**Scope:** Full responsive refit of the trello-foundation app across mobile (320–767px), tablet (768–1023px), and desktop (≥1024px). Every interactive surface that ships today must remain usable on phone and tablet without information loss.

## 1. Goal

Deliver a true touch-first experience for the internal team's phones and tablets while preserving the desktop Studio Console aesthetic and DESIGN.md doctrine. Same code path, same data, three viewports.

Success: a triage session that today happens on a 27" desktop can happen on an iPhone 13 (375×812) or an iPad mini (744×1133) with no missing capability and no horizontal page scroll (board kanban excepted — its horizontal scroll is the affordance, not a bug).

## 2. Anti-goals

- No separate mobile app. No `/mobile/*` route tree. No UA sniffing.
- No mobile-only feature gates. Anything the desktop user can do, the phone user can do (possibly via a different gesture).
- No new color, no new typeface, no new elevation tier. The work is layout, density, hit-target, and gesture — never decoration.
- No information architecture divergence between viewports. Same paths, same nav, same names.
- No CSS-only viewport-scaling tricks (`viewport=width=device-width, initial-scale=1` stays; no `transform: scale()` shrink hacks).

## 3. Doctrine

### Breakpoints

Use Tailwind's defaults, not custom values. Predictable for the codex agents and matches the design system already in use.

| Token | Min width | Devices |
|---|---|---|
| (base) | 320px | iPhone SE, small Android |
| `sm:` | 640px | Large phones landscape |
| `md:` | 768px | iPad mini portrait, tablets |
| `lg:` | 1024px | iPad landscape, small laptop |
| `xl:` | 1280px | Desktop |
| `2xl:` | 1536px | Wide desktop |

**Tier mapping** for plain-English doctrine sections below:
- **Mobile** = base..`md:` (`<768`)
- **Tablet** = `md:`..`lg:` (`768..1023`)
- **Desktop** = `lg:` and up (`≥1024`)

Where viewport queries are wrong (e.g., a card-meta sidebar that should collapse when the parent panel is narrow, regardless of viewport), use **container queries** (`@container`). Tailwind v4 supports them natively.

### Touch-target floor

DESIGN.md sets `≥32px primary / ≥24px dense`. That stands on desktop. On touch viewports it is **not enough**.

- **Touch viewport (no `pointer: fine`)** every interactive control: ≥44×44px. Implement with a `.touch-target` utility (`min-h-11 min-w-11`) gated by a `@media (hover: none) and (pointer: coarse)` block, OR with `lg:` overrides that re-introduce the 32px density on hover-capable devices.
- Drag handles and resize edges stay 24px **on desktop only**. On touch they become 32px and use long-press activation (`@dnd-kit/core` `PointerSensor` `delay: 200, tolerance: 5` — see `useDndSensors` helper to add).

### Type, line length, spacing

- Body type stays `0.875rem` on every viewport. The font is already legible at 14px. Do NOT bump to 16px on mobile.
- Line length stays 65–75ch in long-form (card description, comments).
- Spacing scale: page-level padding reduces on mobile.
  - `p-6` desktop → `p-4` tablet → `p-3` mobile, applied as `p-3 md:p-4 lg:p-6` on page wrappers.
  - Card / list internal padding stays `p-2.5` / `p-3` across viewports. Density is the doctrine.

### Idle Mute holds

Idle UI stays grayscale at every viewport. No new color tokens. No introducing a `--mobile-accent`. Drag halos, focus rings, status pills are the only chroma at any viewport.

### Modal vs sheet

Modals are still discouraged (DESIGN.md "modal as first thought" is banned). Where one exists today (card modal, quick-add, settings dialogs), on mobile it becomes a **bottom sheet** sliding from the bottom with a 12px top-radius and a 32px tall drag-handle stripe.

- New primitive: `BottomSheet` in `components/ui/bottom-sheet.tsx`. Built on Base UI's `Dialog` (already a dep) so the focus-trap, escape-to-close, and aria-modal semantics are free.
- On `md:` and up the same component renders as the existing centered dialog. One API, two presentations. Route the choice with a `useMediaQuery("(min-width: 768px)")` hook (new in `lib/use-media-query.ts`).

### Gestures

- **Horizontal swipe** between lists on the board is the existing `overflow-x-auto` scroll. Don't replace with a snap-paged carousel — the user wants to see the previous list peeking. Add `scroll-snap-type: x mandatory` only when the viewport is ≤640px, with `scroll-snap-align: start` on each list column. That gives "swipe to next list" feel without losing the panoramic view.
- **Pinch zoom** on `roadmap-view` and `workload-view`: implement via CSS `transform: scale()` on the chart canvas, hooked to a two-finger pinch (use `usePinchZoom` hook — write in `lib/use-pinch-zoom.ts`). Pan is the existing `overflow: auto` scroll on the wrapper.
- **Long-press** = right-click on touch. Wire to existing context menus where they exist (none ship today; the bulk action bar replaces multi-select); leave deferred.

### Reduced motion

DESIGN.md mandates honoring `prefers-reduced-motion`. The new sheet slide-up animation, pinch-zoom transitions, and pull-to-refresh (if added) MUST short-circuit when that media query is on.

## 4. Surface-by-surface adaptation

### 4.1 App shell (top-nav, app/(app)/layout.tsx)

Current state: top-nav already has `lg:hidden` for mobile menu, `md:hidden` for compact search. Workable but unpolished.

Changes:
- Hamburger drawer (`<md:`) opens a full-height slide-in from the left, **not** a dropdown. Width `min(85vw, 320px)`. Renders the same primary + secondary links as desktop, stacked vertically with 44px hit targets.
- Workspace switcher inside the drawer on mobile (currently in the header alongside brand, eats horizontal space).
- Brand monogram stays in the header; brand wordmark drops `<sm:`.
- Account menu becomes the drawer footer on mobile.
- Notification bell stays in the header at every viewport (it's the most-clicked icon).
- Command palette (⌘K) keeps its keyboard chord but also exposes a search icon in the mobile header.
- The notification bell popover is full-width-minus-16px on `<sm:`; today it overflows.
- Search input that today is hidden `<md:` should become reachable via the magnifier icon → expand-in-place input that pushes the rest of the header off-screen until dismissed.

### 4.2 Board view (components/board/board-view.tsx + children)

Current state: masthead wraps; list columns horizontal-scroll. Functional on mobile but cramped.

Changes:
- Masthead reflows to two rows `<md:`: row 1 = board code + title + presence; row 2 = filter bar + sprint toggle + activity toggle + settings. Row 2 horizontally scrolls if needed (chips already pill-shaped).
- List column width stays `w-80` (320px) on desktop. On `<sm:` shrinks to `w-[85vw] max-w-[320px]` so the next list peeks. Apply `scroll-snap` to the columns container.
- `card-tile` chips wrap to a second line `<sm:`. Today they truncate; that's a regression because metadata gets lost. Allow wrap, cap at two rows total.
- `add-list-form` shrinks to match the list-column responsive width.
- `bulk-action-bar` floats at the bottom on mobile (already does on desktop, but cramped). On `<md:` it occupies `bottom-2 inset-x-2` instead of `bottom-4 inset-x-auto`. Buttons inside scroll horizontally with snap, label text hidden `<sm:` (icon-only with mono-meta tooltip).
- `board-filter-bar` becomes a single trigger button on `<md:` ("Filters · 2") that opens a BottomSheet with the full filter UI.
- `sprint-drop-strip` collapses to a horizontal-scroll strip on mobile; the bands stack into pills 32px tall with mono labels.
- `presence-avatars` already overlap; cap visible at 3 on `<sm:` (currently 5).
- Swimlane (`lanes=member` etc.) on `<sm:` collapses each lane to a single column of cards full-bleed, lane title sticky-top.

### 4.3 Card modal (components/board/card-modal.tsx)

Current state: centered dialog, `sm:max-w-3xl`, two-column meta sidebar inside, lots of section subcomponents. ~0 responsive treatment otherwise. Most pain on phone.

Changes:
- Wrap in the new `BottomSheet` on `<md:`. Sheet is 92vh tall with a 12px top-radius and a 32px drag handle stripe (`mono-meta` "DRAG TO DISMISS" optional, or just a 4px-tall, 36px-wide grab bar centered).
- Header: title input gets larger touch target (`min-h-12`) and the `text-2xl md:text-3xl` already exists. Keep.
- Meta sidebar (members, labels, due, priority, story points, type, parent, sprint, watchers, time, roadmap dates) is a column at `≥md:`. On `<md:` it collapses into a **horizontal-scroll pill strip** anchored under the title: each pill is one meta field rendering current value ("MEMBERS · 2", "DUE · MAY 12", "PRI · P1", …); tapping a pill opens that field's existing picker UI as a nested BottomSheet that stacks on top of the card sheet.
- Description editor stays full-width inline at every viewport; `max-h-[60vh]` keeps the scroll local.
- Comments stay full-width and stacked. Avatar + body. Already mobile-tolerant; just verify hit targets on reply / edit / delete dot-menu.
- Attachments grid `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`. Today it's `grid-cols-3` flat.
- Checklist items: 44px row on touch, drag handle revealed `lg:` only (on touch, long-press anywhere on the row to drag).
- Subtasks panel: master list shrinks to full-width below on `<md:`, parent picker stays at top.
- Activity tab inside the card (if rendered) inherits its parent sheet width.

### 4.4 Wide data viz (roadmap, workload, me-week-gantt, burndown)

Current state: desktop-only. Hard to read at any size below 1024px.

Changes:
- All four wrap in a horizontally-scrollable canvas region. That already exists today. The work is the **control bar above the canvas** and the **header sticky behavior**.
- Roadmap (`components/roadmap/roadmap-view.tsx`):
  - Control bar (zoom, range filter, density toggle, lane mode, etc.) becomes a single "Display" trigger on `<md:` that opens a BottomSheet.
  - Lane label column is 200px desktop / 140px tablet / 96px mobile, with truncation + tooltip.
  - Priority gutter (64px) stays visible at every viewport (it's structural).
  - Pinch-to-zoom on the chart body. Horizontal scroll already works; sticky-top sprint/week header has to keep working at small viewports (verify `position: sticky` survives the new transform wrappers).
- Workload (`components/workload/workload-view.tsx`):
  - Same pattern: collapse control bar into a sheet, person label column shrinks.
  - 27-row density (the new redesign) is preserved at every viewport; just adjust label column width.
- Me-week-gantt (`components/me/me-week-gantt.tsx`): seven columns are non-negotiable; reduce header day-name to single letter `<sm:` ("M / T / W / T / F / S / S") and rely on the date strip below.
- Burndown chart: SVG already scales. Wrap legend below the chart on `<md:`.

### 4.5 Workspace pages (app/(app)/w/[workspaceId]/**)

Current state: pages mostly desktop-grid. Few have responsive grid-cols.

Changes (per page):
- **Backlog** (`backlog/page.tsx`): table → card list `<md:`. Sort/filter row becomes single Filters trigger.
- **All-tasks** (`all-tasks/page.tsx`): same pattern as backlog.
- **Boards** (`boards/page.tsx`): grid `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`. Today fixed `lg:grid-cols-3`.
- **Archive** (`archive/page.tsx`): list view; ensure 44px row hit targets.
- **Settings** (`settings/page.tsx`): label/control two-column → stacked `<md:`. Save bar sticky bottom on mobile.
- **Versions index** (`versions/page.tsx`) + detail (`versions/[versionId]/page.tsx`): table → card list `<md:`.
- **Sprints detail** (`sprints/[sprintId]/page.tsx`) + report (`report/page.tsx`): two-pane → stacked `<md:`.
- **Sub-board** (`e/[sub-boardId]/page.tsx`): hero metric strip wraps; child board uses the same board adaptations as 4.2.
- **Roadmap** (`roadmap/page.tsx`): adopt 4.4 roadmap changes.

### 4.6 Dashboards (app/(app)/dashboards/**)

- Index page card grid: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`.
- Dashboard detail (`[dashboardId]/page.tsx`): tiles are draggable; on touch reduce drag-to-rearrange to a kebab → "Move…" action sheet (drag stays available `lg:` and up).

### 4.7 Inbox (app/(app)/inbox/page.tsx + components/inbox/inbox-list.tsx)

Master-detail pattern: list left, detail right on desktop.

Changes:
- `<md:` collapses to list-only. Tapping a notification opens its target route (the existing behavior) or a BottomSheet preview if the target is in-app.
- `inbox-list.tsx` already has `overflow-x-auto` — drop that on `<md:`.

### 4.8 Onboarding, auth, me, settings sub-pages

- Onboarding tour overlay (`components/onboarding/tour-overlay.tsx`): repositions tooltip cards to the bottom on mobile to avoid covering the target.
- Auth pages: already `max-w-sm`. Verify `min-h-screen` works with mobile chrome (use `100dvh`, not `100vh`).
- `app/(app)/me/page.tsx`: already `grid-cols-1 lg:grid-cols-2`. Confirm.
- `app/(app)/settings/notifications/page.tsx`: stack control rows on `<md:`.
- `app/(app)/settings/profile/page.tsx`: same.

### 4.9 Floating chrome (toaster, error pane, undo banner, shortcuts overlay, command palette)

- Sonner: `Toaster` position stays bottom-right desktop. Switch to `bottom-center` and `width: 100% - 16px` on `<sm:` via `theme` prop.
- `error-pane.tsx` and `undo-banner.tsx`: already opaque popover (DESIGN.md "Solid Popover Rule"). Width matches sonner pattern.
- `shortcuts-overlay.tsx`: keyboard reference, suppress on touch (`hidden md:flex`).
- `command-palette.tsx`: full-screen sheet on mobile (the dialog gets `inset-0` instead of centered card).

### 4.10 UI primitives (components/ui/**)

- `dialog.tsx`: unchanged in API. `BottomSheet` is a separate sibling component sharing the same Base UI primitive. Callers compose them via `ResponsiveModal`, never via a `variant` prop on `Dialog`.
- `dropdown-menu.tsx`: on touch, popover opens upward when bottom-aligned would clip — Base UI handles this if `side="bottom"` + `align="start"` is set with `avoidCollisions` enabled. Verify.
- `select.tsx`: on `<md:`, switch to a native `<select>` for trigger? No. The current custom Select supports search and grouping; that wins. Just ensure the popover panel is `max-h-[60vh]` and scrollable.
- `input.tsx`: gains `min-h-11` on touch viewports (via `[@media(hover:none)_and_(pointer:coarse)]:min-h-11` arbitrary variant or a `.touch-target` utility class).
- `button.tsx`: same touch-target rule. Size variants stay 28/32/36/44px but on touch the bottom three floor to 44px effective hit area via `padding: max(0, 44px - var(--btn-h)) / 2`. Easier: just make `sm` and `md` Button variants pick up the `.touch-target` utility.

## 5. New utilities and primitives

Files to create:

- `components/ui/bottom-sheet.tsx` — Base UI Dialog with sheet styling, drag-handle bar, slide-up animation, `prefers-reduced-motion` short-circuit.
- `components/ui/responsive-modal.tsx` — wraps the choice: `<md:` → BottomSheet, `≥md:` → Dialog. Common API: `<ResponsiveModal open onClose title>{children}</ResponsiveModal>`.
- `lib/use-media-query.ts` — typed wrapper around `window.matchMedia` with SSR-safe initial value.
- `lib/use-pinch-zoom.ts` — two-finger pinch handler returning `{ scale, reset }` for the roadmap and workload chart bodies.
- `lib/use-touch-device.ts` — `(hover: none) and (pointer: coarse)` matcher; used to swap drag activation, hit-target sizing.

CSS additions in `app/globals.css`:

- `.touch-target { @apply min-h-11 min-w-11; }` gated by `[@media(hover:none)_and_(pointer:coarse)]:` variant or a `:where()` block.
- `.scroll-snap-x { scroll-snap-type: x mandatory; }` + `.snap-start { scroll-snap-align: start; }` (Tailwind already provides these; verify the build picks them up).
- Container query setup on `.card-modal-shell` (or whatever the wrapper is named) so the meta sidebar collapses based on its own width, not the viewport.
- `--safe-area-inset-*` vars wired via `env(safe-area-inset-bottom)` for iOS notch / home indicator under bottom sheets and the bulk action bar.

`app/(app)/layout.tsx`:

- Set `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` in the root layout. Required to surface `env(safe-area-inset-*)`.
- Replace any `h-screen` with `h-dvh` / `min-h-dvh`.

## 6. Constraints for implementers

- **Don't introduce new colors** beyond the existing tokens in DESIGN.md. The Idle Mute Rule holds.
- **Don't introduce a fourth typeface.** Geist + Geist Mono + Instrument Serif. Stop.
- **Don't animate layout properties** (width/height/top/left). Use `transform` and `opacity`. Ease-out cubic-bezier(0.16, 1, 0.3, 1).
- **Don't add modals where there are none.** Sheets replace dialogs at small viewports; don't add new dialogs as part of this work.
- **Don't break existing keyboard / shortcut behavior.** All mouse + keyboard parity rules in DESIGN.md still hold on desktop after the touch adaptations land.
- **Don't drop features on mobile.** Every desktop interaction must have a touch equivalent.
- **Don't ship `display: none` to hide functionality.** Restructure or collapse instead.
- **Don't break the existing playwright test suite.** Most tests target desktop viewports; they must still pass. Add targeted mobile-viewport tests for the new sheet primitive and the board kanban swipe behavior.
- **Don't use em dashes in UI copy** (`--` or `—`). Commas, colons, semicolons, periods, parentheses.

## 7. Decomposition into work packets (for parallel codex agents)

Each packet is independent enough to run in its own worktree. Cross-cutting deliverables (Packet 1) land first; the rest run in parallel.

**Packet 1 — Foundation (must land first).** New primitives + tokens.
- `lib/use-media-query.ts`, `lib/use-touch-device.ts`, `lib/use-pinch-zoom.ts`
- `components/ui/bottom-sheet.tsx`, `components/ui/responsive-modal.tsx`
- `app/globals.css` additions (`.touch-target`, safe-area vars, scroll-snap helpers, container query setup)
- `app/layout.tsx` viewport meta + `100dvh` replacements
- `components/ui/dialog.tsx`, `components/ui/input.tsx`, `components/ui/button.tsx`, `components/ui/select.tsx`, `components/ui/dropdown-menu.tsx` touch-target audit
- Tests: vitest unit for `use-media-query`, `use-touch-device`; playwright smoke for sheet open/close at 375px viewport.

**Packet 2 — App shell.** Top-nav drawer + command palette + notification bell + account menu.
- `components/nav/top-nav.tsx`
- `components/nav/account-menu.tsx`
- `components/nav/notification-bell.tsx`
- `components/command-palette.tsx`
- Tests: existing nav playwright tests at 375 + 768 + 1280 viewports.

**Packet 3 — Board surfaces (non-modal).**
- `components/board/board-view.tsx`, `list-column.tsx`, `card-tile.tsx`, `add-list-form.tsx`, `add-card-form.tsx`, `board-filter-bar.tsx`, `sprint-drop-strip.tsx`, `bulk-action-bar.tsx`, `swimlane-row.tsx`, `presence-avatars.tsx`, `board-members-panel.tsx`
- Tests: board playwright suite at 375 + 768 + 1280.

**Packet 4 — Card modal.**
- `components/board/card-modal.tsx`
- `components/board/card/*.tsx` (members-section, labels-section, due-section, priority-picker, story-points-picker, type-picker, parent-picker, watch-toggle, time-section, roadmap-dates-section, attachments-section, comments-section, checklists-section, subtasks-section, cover-picker, card-links-section, tile-indicators)
- Switch the modal route at `app/(app)/b/[boardId]/@modal/(.)c/[cardId]/page.tsx` and the standalone `c/[cardId]/page.tsx` to use ResponsiveModal.
- Tests: card-modal playwright suite at 375 + 1280.

**Packet 5 — Wide data viz.**
- `components/roadmap/*` (full directory)
- `components/workload/workload-view.tsx`
- `components/me/me-week-gantt.tsx`
- `components/sprint/burndown-chart.tsx`
- New: `lib/use-pinch-zoom.ts` if not already landed in Packet 1
- Tests: roadmap + workload playwright at 375 + 1024.

**Packet 6 — Workspace pages.**
- `app/(app)/w/[workspaceId]/backlog/page.tsx`
- `app/(app)/w/[workspaceId]/all-tasks/page.tsx`
- `app/(app)/w/[workspaceId]/boards/page.tsx`
- `app/(app)/w/[workspaceId]/archive/page.tsx`
- `app/(app)/w/[workspaceId]/settings/page.tsx`
- `app/(app)/w/[workspaceId]/versions/page.tsx`
- `app/(app)/w/[workspaceId]/versions/[versionId]/page.tsx`
- `app/(app)/w/[workspaceId]/sprints/[sprintId]/page.tsx`
- `app/(app)/w/[workspaceId]/sprints/[sprintId]/report/page.tsx`
- `app/(app)/w/[workspaceId]/e/[sub-boardId]/page.tsx`
- `app/(app)/w/[workspaceId]/roadmap/page.tsx` (page shell only; chart body is in Packet 5)
- Supporting components under `components/workspace/`, `components/sub-board/`, `components/sprint/` (except `burndown-chart.tsx`), `components/versions/`, `components/archive/`
- Tests: workspace playwright suite at 375 + 768 + 1280.

**Packet 7 — Dashboards.**
- `app/(app)/dashboards/page.tsx`
- `app/(app)/dashboards/[dashboardId]/page.tsx`
- `components/dashboard/*`
- Tests: dashboard playwright at 375 + 1280.

**Packet 8 — Inbox + Settings + Me + Auth + Onboarding + Floating chrome.**
- `app/(app)/inbox/page.tsx`, `components/inbox/*`
- `app/(app)/settings/page.tsx`, `app/(app)/settings/notifications/page.tsx`, `app/(app)/settings/profile/page.tsx`, `components/settings/*`
- `app/(app)/me/page.tsx`, `components/me/*` except `me-week-gantt.tsx` (Packet 5)
- `app/(auth)/**` confirmation pass (already mostly mobile-friendly; the `100dvh` and viewport-fit changes from Packet 1 should be verified here)
- `components/onboarding/tour-overlay.tsx`
- `components/error-pane.tsx`, `components/undo-banner.tsx`, `components/shortcuts-overlay.tsx`, `components/ui/sonner.tsx`
- Tests: inbox + settings playwright at 375 + 1280.

## 8. Verification

Before each packet is considered done:

1. `npm run lint && npm run type-check` clean.
2. `npm run test:unit` (vitest) green.
3. `npm run test:e2e` (playwright) green at the packet's listed viewports.
4. Manual smoke: open dev server, set DevTools device to iPhone 13 (375×812) and iPad mini (744×1133), exercise the surface in scope. Confirm:
   - No horizontal page scroll (board kanban excepted).
   - All hit targets ≥44px on touch viewport.
   - No truncated content that can't be reached via expand/scroll.
   - Sheets dismiss via swipe-down OR escape OR backdrop tap.
   - Reduced-motion media query disables sheet slide animation.

After all packets:

5. Run the full playwright suite at 375 + 768 + 1024 + 1280 viewports.
6. Lighthouse mobile audit on the board route — accessibility ≥95, no horizontal-scroll violation, no tap-target violation.

## 9. Out of scope

- Native mobile app (React Native, Capacitor). Web only.
- PWA install prompt, manifest, offline shell. Separate ticket.
- Pull-to-refresh. Separate ticket; the existing realtime channel keeps state fresh.
- Haptics. Web Vibration API support is patchy.
- Voice input, screen-reader-specific copy variants beyond DESIGN.md's existing accessibility commitments.
