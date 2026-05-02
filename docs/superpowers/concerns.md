# Known limits / caveats

Living doc of intentional gaps, deferred items, and workarounds in the trello-foundation app. Update when a new constraint is accepted or a deferred item ships.

> **Status legend**
> 🟡 deferred — known gap, ship later
> 🔧 workaround — temporary technical compromise
> 🚧 blocked — needs upstream input/decision
> ✅ accepted — by-design tradeoff

---

## Performance & scale

| Area | Limit | Status |
|---|---|---|
| Cards per list | Hard cap 100 rendered + "Show all (N more)" toggle (`feat(board): cap rendered cards per list at 100`). Full row virtualization deferred until in-practice list size exceeds ~200. | 🟡 |
| Roadmap virtualization | None. Same defer threshold (>200 cards). | 🟡 |
| Cmd+K fuzzy match | Simple `indexOf` + length-penalty score. No `fuse.js` / Levenshtein. | ✅ |
| Workspace search | Linear scan over hydrated workspace store. No server-side index. | ✅ |

## Gantt / Roadmap

| Area | Limit | Status |
|---|---|---|
| Bulk-select / lasso | Not implemented on Gantt. Per-card multi-select only via Kanban. | 🟡 |
| Inline date input | Rejected. Drag is the primary date-edit affordance. Edit-dates accessible via overflow menu (A2). | ✅ |
| Mini-map / overview scrollbar | Shipped (γ-Master C6 — `components/roadmap/mini-map.tsx`). Click + drag, viewport rect, slider role. | ✅ |
| Print stylesheet | Shipped (γ-Master C8). Landscape `@page`, hide chrome, color preserved via `print-color-adjust`. | ✅ |
| PDF export | None. Use browser print → "Save as PDF" (now with C8 stylesheet). | ✅ |
| Per-assignee swimlane | Shipped (γ-Master C9). `card_members` snapshot + realtime extension. URL-state `?lanes=assignee`. | ✅ |
| Per-component swimlane | Shipped (γ-Master C10). URL-state `?lanes=component`. | ✅ |
| Drag bar auto-scroll near edges | Shipped (γ-Master C3 / γ-G G5 alias). RAF tick at canvas edge during any active bar/paint/chip/row drag. | ✅ |
| Snap to dependency ends | Shipped (γ-Master C4 + γ-G G6 polish). 4-day window, blocker target_dates injected into snap candidates, Alt-bypass, visual snap guide. | ✅ |
| Drag-paint empty area → new card | Shipped (γ-G G3). Pointerdown on empty row → drag rect → A4 dialog with start/target/parent/board prefilled. Supersedes the earlier D2 click variant (kept as a < 4 px click case). | ✅ |
| Header chip drag → new card | Shipped (γ-G G7). Floating ghost chip, drop on row → A4 dialog with `defaultStart=dropDay, defaultTarget=+7d`. | ✅ |
| Manual row reorder | Shipped (γ-G G1). Sparse-int `cards.roadmap_order`, `≡` drag handle on epic-mode lanes, full-board renumber on rank collision under `pg_advisory_xact_lock`. Activity log entry skipped (UI affordance, not audit-relevant). | ✅ |
| Cross-epic-lane reparent via drag | Shipped (γ-G G2). Vertical lane crossing during bar drag writes `parent_card_id`. Cycle errors route to error pane. Dep-break confirm dialog deferred (silent commit per plan). | ✅ |
| Priority gutter (drag bar to set enum) | Shipped (γ-G G4). Sticky 64px left strip, P0–P4 bands, URL toggle `?gutter=1`. Bars tinted by priority always. Overflow-menu flat priority entries for keyboard parity. | ✅ |
| Drag Kanban tile → sprint band | Deferred (γ-Master D1). Requires dnd-kit context plumbed across Kanban + Gantt — non-trivial. Cut from γ pending a separate plan. | 🟡 |

## Cross-view consistency

| Area | Limit | Status |
|---|---|---|
| `card_links` workspace realtime | Live on board pages (γ-Master B4 — `useWorkspaceRealtime` mounted in `BoardView`). Per-board + per-workspace channels both subscribe to current board's tables; accepted dual-write into separate stores. | ✅ |
| Inbox `card.dates` deep-link | Shipped (γ-Master D3). Routes to `/w/<workspaceId>/roadmap?focus=<cardId>` for both inbox list and notification bell. Other notification kinds keep the card modal link. | ✅ |
| Activity "set roadmap dates" link | Shipped (γ-Master D4). Board ActivityFeed and CardActivity panel both wrap `card.dates` rows in a roadmap-focus link. | ✅ |

## Bulk operations

| Area | Limit | Status |
|---|---|---|
| Multi-select | Click + shift/cmd select on Kanban only. No marquee / lasso. | 🟡 |
| Bulk-edit fields | Move list, label, assign, archive, sprint, component. No bulk priority / dates / cover. | 🟡 |

## Forms

| Area | Limit | Status |
|---|---|---|
| Custom forms / intake | Not started. Plan γ-E queued, blocked on user pasting item titles 49-53. | 🚧 |

## Accessibility & testing

| Area | Limit | Status |
|---|---|---|
| Formal WCAG audit | Not run. Plan γ-F queued, blocked on user pasting items 16, 17, 58-60. | 🚧 |
| axe-core integration | None. | 🟡 |
| Snapshot tests | None. | 🟡 |
| Keyboard traps | Manually verified per feature. No systematic check. | 🟡 |

## Realtime

| Area | Limit | Status |
|---|---|---|
| Card subscriptions | Scoped to current board. Cross-board updates rely on workspace store refetch on focus. | ✅ |
| Workspace store | Single subscription channel via β. Adding new tables requires extending the realtime config explicitly. | ✅ |

## Demo / seed data

| Area | Limit | Status |
|---|---|---|
| Demo Sprint 1 naming | Renamed to avoid E2E collision with user-created "Sprint 1" (commits `2df6ff4`, `e1fe30f`). User-invisible technical workaround. | 🔧 |

## Editor / content

| Area | Limit | Status |
|---|---|---|
| Rich-text card description | Plain textarea (no markdown preview, no @mentions inline). Mentions supported via separate `@` picker. | ✅ |
| Attachments | Single-file upload per card, stored in Supabase storage. No multi-attach drag-drop on card body. | 🟡 |

---

## Out-of-scope for current epic (γ)

The following were explicitly out of scope for #16b-γ and are not yet planned:

- Real lasso/marquee bulk-select on Gantt
- Time-zone–aware date editing (all dates currently treated UTC-naive)
- Public board sharing / read-only links
- Per-board permissions beyond workspace role
- Webhooks / external integrations

## How to update this doc

When a deferred item ships → flip status, move to a "Resolved" section at the bottom (or delete if no longer relevant). When a new caveat is accepted during a plan, add it here in the same commit so it doesn't get lost.
