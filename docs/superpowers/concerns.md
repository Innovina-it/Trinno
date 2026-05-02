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
| Mini-map / overview scrollbar | Deferred (γ-Master C6, ~2 hr — largest single item). | 🟡 |
| Print stylesheet | Deferred (γ-Master C8). Browser `Cmd+P` works but chrome leaks into output. | 🟡 |
| PDF export | None. Use browser print → "Save as PDF". | ✅ |
| Per-assignee swimlane | Deferred (γ-Master C9). Data already in workspace store via β. | 🟡 |
| Per-component swimlane | Deferred (γ-Master C10). | 🟡 |
| Drag Kanban tile → sprint band | Deferred (γ-Master D1). Requires dnd-kit context plumbed across Kanban + Gantt — non-trivial. May be cut from γ entirely. | 🟡 |

## Cross-view consistency

| Area | Limit | Status |
|---|---|---|
| `card_links` workspace realtime | Live on board pages (γ-Master B4 — `useWorkspaceRealtime` mounted in `BoardView`). Per-board + per-workspace channels both subscribe to current board's tables; accepted dual-write into separate stores. | ✅ |
| Inbox `card.dates` deep-link | Routes to card modal, not Gantt focus. Fix queued (γ-Master D3). | 🟡 |
| Activity "set roadmap dates" link | Opens card modal instead of roadmap view. Fix queued (γ-Master D4). | 🟡 |

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
