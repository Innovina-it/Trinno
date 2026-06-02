# Plan #16b-γ-Gantt-Master — All remaining Gantt + integration improvements

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.
>
> Large slice (28 changes). Subagent should split into 4-5 sub-batches, commit per batch.

**Scope:** Everything still missing on the Gantt + cross-view consistency. Combines γ-Gantt-CRUD + γ-Wrap-up + new ideas surfaced in audit.

**Out of scope:** Real bulk-select / lasso (separate slice if desired). Print/PDF export (use browser print for now).

---

## Tasks (28 items, grouped)

### Group A — CRUD parity on Gantt (γ-Gantt-CRUD, 9 items)

| # | Task | Effort |
|---|---|---|
| A1 | Click bar → opens card modal (drag-suppressed) | 15 min |
| A2 | Hover overflow chevron → menu (Open card / In board / Edit dates / Archive) | 45 min |
| A3 | Search input in roadmap header (URL-state, debounced) | 30 min |
| A4 | "+ New card" dialog (board+list+title+dates) | 1 hr |
| A5 | Bar hover tooltip (title, type, priority, sp, assignees, status, sprint) | 45 min |
| A6 | Filter chip parity with Kanban (members, labels, type, sprint, overdue, mine) | 1.5 hrs |
| A7 | Keyboard shortcuts (`/`, `Esc`, arrows, +/-, `n`, `?`) | 1 hr |
| A8 | Epic-lane row title links to epic card | 15 min |
| A9 | Verify | 30 min |

### Group B — Workspace context on board pages (γ-Wrap-up, 5 items)

| # | Task | Effort |
|---|---|---|
| B1 | Mount `WorkspaceStoreProvider` on board pages | 1 hr |
| B2 | Sprint NAME on Kanban tile (replace "IN SPRINT") | 30 min |
| B3 | Status badge on Kanban tile (from `lists.status_kind`) | 30 min |
| B4 | `card_links` workspace realtime extension | 30 min |
| B5 | `docs/superpowers/concerns.md` — known limits | 15 min |

### Group C — Gantt UX polish (new ideas)

| # | Task | Effort |
|---|---|---|
| C1 | "Today" vertical indicator line on roadmap | 15 min |
| C2 | Weekend shading (subtle stripes Sat/Sun) | 30 min |
| C3 | Auto-scroll when dragging bar near viewport edge | 30 min |
| C4 | Snap to dependency ends — drop A's start onto B's end snaps | 1 hr |
| C5 | Visible date-range picker / jump-to-date control in header | 45 min |
| C6 | Mini-map / overview scrollbar at top of roadmap | 2 hrs |
| C7 | Tooltip on critical-path toggle explaining what "critical" means | 15 min |
| C8 | Print stylesheet (paginates per quarter, hides chrome) | 1 hr |
| C9 | Per-assignee swimlane mode on roadmap | 1 hr |
| C10 | Per-component swimlane mode | 1 hr |

### Group D — Cross-view bidirectional polish

| # | Task | Effort |
|---|---|---|
| D1 | Drag Kanban tile onto a sprint-overlay band (in mini-map) → assigns to sprint | 2 hrs |
| D2 | Roadmap "+ New card" can drop bar directly via empty-area click → opens dialog with start_date prefilled | 30 min |
| D3 | Inbox notification deep-link to Gantt focus when activity is `card.dates` | 15 min |
| D4 | Activity feed entry "set roadmap dates" links to roadmap (not just card modal) | 15 min |

---

## Suggested execution order

```
A1 → A2 → A3 → A4 → A5 → A6 → A7 → A8 → A9   (CRUD batch)

B1 (must precede B2/B3 — needs workspace store on board pages)
B1 → B2 → B3 → B4 → B5

C1 → C2 → C7 (cosmetic, easy)
C3 → C4 (drag-related)
C5 → C6 (navigation)
C8 (print)
C9 → C10 (depends on B1)

D1 → D2 → D3 → D4 (rides on previous groups)
```

## Total effort

| Group | Items | Time |
|---|---|---|
| A — CRUD | 9 | ~6 hrs |
| B — Wrap-up | 5 | ~2.75 hrs |
| C — UX polish | 10 | ~7.5 hrs |
| D — Cross-view | 4 | ~3 hrs |
| **Total** | **28** | **~19 hrs** subagent (~2.5 days) |

---

## Constraints

- Preserve all existing `data-testid`s, accessible names, dnd-kit IDs.
- No new deps. Use `lucide-react` icons + base-ui shadcn primitives.
- Mono palette intact.
- After each batch: `npx tsc --noEmit` + `npm run build` + `npm run test:unit` clean.
- E2E: existing 9+ specs must still pass. Don't add new E2E unless functionality genuinely needs regression coverage.

## Self-Review Notes

- **Single mega-plan vs split**: kept as one for queue clarity. Subagent runs in 4 batches (A → B → C → D) with checkpoint commits.
- **Mini-map (C6)** is the largest single item. If time-constrained, defer to a separate slice.
- **Print stylesheet (C8)**: `@media print` rules in `globals.css` + section that hides chrome. Browser handles pagination natively if `break-inside: avoid` is set per row.
- **Per-assignee/component swimlanes (C9/C10)** require workspace store data on roadmap (already have via β).
- **Drag tile → sprint band (D1)** requires plumbing dnd-kit context across views — non-trivial. Consider deferring if scope creeps.
