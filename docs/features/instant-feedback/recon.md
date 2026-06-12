# Recon — instant-feedback (Gate 0, frozen 2026-06-12)

## Original brief (foundational-systems doc, point 2)
"One consistent instant-feedback pipeline: every edit updates the screen instantly, sends the change in background, rolls back with an error message if the server says no. Claim: card-modal field edits wait for the server (laggy). Bonus: helper produces the how-to-reverse info point 1 needs."

## Reality check — the brief is largely OUTDATED (in a good way)

### Already instant (23 sites)
All card-modal sections/pickers (priority, owner, parent, story points, dates, due, cover, labels, members, links, checklists, comments, attachments, complete), roadmap bar completion, component toggle — all patch local state BEFORE awaiting the server, with rollback + toast on failure, and (since undo-redo-stack) undoBus entries with rethrow semantics. The doc's central claim about laggy card-modal fields is no longer true.

### Genuinely laggy stragglers (2 sites)
- time-section.tsx:60 saveEstimate — awaits updateCard, THEN patches local (wait-first)
- type-picker.tsx:76 change — awaits updateCard, then patches; also NO rollback and NO undo entry

### The REAL instant-feedback problem: 25+ router.refresh() sites (the "blink")
Full-page refresh as feedback mechanism — screen flash, scroll loss:
- bulk-action-bar.tsx — 8 bulk ops (complete/archive/move/label/assign/sprint/priority/component): push undo entries but then router.refresh() → flash after every bulk op. HIGH VALUE target.
- workspace-switcher (4), workspace-settings-form (4), member-list (3), board-members-panel (2), board-settings-form, board-view (3), move-to-board-dialog, quick-add-card-dialog (2), inbox-list (3), roadmap-view (1), dashboard/*, sprint/* — settings/admin surfaces, lower frequency.

### No-rollback risks found
type-picker (above), favorite-toggle, label create (onAdd) — divergence on server error.

### Helper seed already exists
The undo-redo-stack work left ~20 near-identical write closures (patch local → await server → catch: patch back + toast + rethrow → undoBus.push with redo). One `optimisticWrite` helper can express all of them; migrating the 23 green sites wholesale is churn with zero user-visible change — migrate on touch instead.

### Store layers the helper must span
BoardStore (updateCard + entity setters), WorkspaceStore (patchCard, setCardLink…), local React state (setOptimistic/onLocalChange). Helper takes an applyLocal callback rather than knowing stores.

## Scope recommendation
- PROCEED: (A) shared `optimisticWrite` helper in lib/ + fix the 2 wait-first stragglers with it (estimate, type — type also gains rollback+undo); (B) bulk-action-bar: replace router.refresh() with store patches for the 8 bulk ops (flagship de-blink; undo entries already there).
- DEFER (phase 2, separate decision): settings/admin refresh surfaces (workspace settings, member roles, dashboards, sprints) — refresh is tolerable there, realtime membership work already covered the worst (foundational item 4).
- SKIP: wholesale migration of the 23 already-optimistic sites (no user-visible gain; adopt helper on touch).
- Brief correction to carry: the doc's "card modal is laggy" premise is stale; the win moved to "stop the blink on bulk ops + kill the 2 stragglers".

## Verification preconditions
Dev server + QA board with ≥3 cards (bulk ops); litmus not registered (vitest directly); no DB changes anywhere.

## Provisional structure (mini-feature, ≤3 units → no FEATURE.md ceremony)
- Unit A1: lib/optimistic-write.ts + estimate & type-picker migration (Tier 2)
- Unit B1: bulk-action-bar de-refresh via store patches (Tier 2 — touches 8 shared ops)
- (optional C, only if asked: settings surfaces phase 2)
