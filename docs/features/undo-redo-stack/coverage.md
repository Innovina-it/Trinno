# Undo/redo action coverage — undo-redo-stack

Generated from code 2026-06-11 (all `undoBus.push` sites + planned Epic B/C wiring).
Legend: U = undo, R = redo. Board sites become multi-step via Unit A1 with zero file changes.

## BOARDS — 41 pre-existing sites. After A1: multi-step undo, 10-min retention. The 16 card-field actions gained redo in Unit E1 (built 2026-06-11).

### Card fields (card modal + side sections)
| Action | U | R | Site |
|---|---|---|---|
| Archive card | U | R | card-modal.tsx:642 |
| Edit title | U | R | card-modal.tsx:682 |
| Edit / clear description (debounced save) | U | R | card-modal.tsx:726 |
| Mark complete / not complete | U | R | card-modal.tsx:834, complete-toggle.tsx:58, due-section.tsx:88 |
| Assign / unassign member | U | R | members-section.tsx:53 |
| Set / clear priority | U | R | priority-picker.tsx:118 |
| Change owner | U | R | owner-section.tsx:72 |
| Set / clear parent card | U | R | parent-picker.tsx:75 |
| Set / clear story points | U | R | story-points-picker.tsx:47 |
| Update roadmap dates (from card) | U | R | roadmap-dates-section.tsx:71 |
| Set / clear time estimate | U | R | time-section.tsx:65 |
| Set / clear due date | U | R | due-section.tsx:49 |
| Set / clear cover | U | R | cover-picker.tsx:140 |
| Add / remove label | U | R | labels-section.tsx:75 |
| Add / remove card link | U | R | card-links-section.tsx:195/217 |
| Toggle component on card | U | R | component-card-section.tsx:55 |

### Comments / attachments
| Action | U | R | Site |
|---|---|---|---|
| Post comment / reply | U | — | comments-section.tsx:132 |
| Edit comment | U | — | comments-section.tsx:217 |
| Resolve / reopen comment | U | — | comments-section.tsx:285 |
| Upload attachment | U | — | attachments-section.tsx:66 |

### Checklists / sub-tasks
| Action | U | R | Site |
|---|---|---|---|
| Add / delete checklist | U | — | checklists-section.tsx:46/95 |
| Add / delete / toggle checklist item | U | — | checklists-section.tsx:306/207/159 |
| Add sub-task | U | — | subtasks-section.tsx:65 |
| Archive / restore sub-task | U | — | subtasks-section.tsx:93 |

### Board structure
| Action | U | R | Site |
|---|---|---|---|
| Archive list | U | — | list-column.tsx:199 |
| Move card to another list (drag) | U | — | board-view.tsx:407 |

### Bulk actions (multi-card, one entry each)
| Action | U | R | Site |
|---|---|---|---|
| Bulk complete | U | — | bulk-action-bar.tsx:179 |
| Bulk archive | U | — | bulk-action-bar.tsx:225 |
| Bulk move | U | — | bulk-action-bar.tsx:278 |
| Bulk add label | U | — | bulk-action-bar.tsx:325 |
| Bulk assign / unassign | U | — | bulk-action-bar.tsx:394 |
| Bulk sprint update | U | — | bulk-action-bar.tsx:444 |
| Bulk priority | U | — | bulk-action-bar.tsx:490 |
| Bulk component toggle | U | — | bulk-action-bar.tsx:552 |

### Inbox
| Action | U | R | Site |
|---|---|---|---|
| Mark notifications read | U | — | inbox-list.tsx:189 |

## ROADMAP — new wiring (Epics B/C). Undo + redo from day one.

| Action | U | R | Unit |
|---|---|---|---|
| Drag bar (shift dates) | U | R | B1 |
| Resize bar (start / end) | U | R | B1 |
| Move bar to another lane | U | R | B1 |
| Cascade shift (N cards, ONE composite step) | U | R | B2 |
| Reorder row | U | R | B2 |
| Move card to another board | U | R | B2 |
| Create milestone | U | R | C1 |
| Update milestone (name/date/color/icon/desc) | U | R | C1 |
| Delete milestone | U | R | C1 |
| Add dependency link | U | R | C2 |
| Remove dependency link | U | R | C2 |
| Set / remove card link chip | U | R | C2 |
| Add / remove card member (from roadmap) | U | R | C2 |
| Deliverable-view edits (same actions underneath) | U | R | C2 (confirm) |

## EXCLUDED (on purpose)
- Baseline approve / compare (own approved-state workflow)
- Text typing inside fields → native browser undo (focus guard)
- Realtime-received changes from teammates (only your own actions enter your stack)
- Comments/attachments/checklists/bulk/inbox stay undo-only by design (ID-rebirth chains, lost blobs, or blast radius make casual redo unsafe there).
- Dependency links (blocks / is_blocked_by) have no roadmap-native mutation surface — arrows are render-only; the card modal's links section is the single site (undo since before, redo via E1 with id-rebirth handling).
- Full page refresh clears both stacks (in-memory by design).
