# Recon — card edit concurrency protection (Gate 0 artifact, consolidated)

Date: 2026-06-11 · Tier: 3 (schema migration on a hot table; prod) · Status: presented at Gate 0, awaiting approval

Consolidates two prior recon passes (this dir + docs/features/concurrent-card-edits/, both 2026-06-11, neither approved at Gate 0). Conflicting migration-state claims re-verified fresh this session; all load-bearing code claims spot-checked.

## Task as briefed

Optimistic-concurrency protection for card edits: a `version` column on `cards` plus a bump trigger, applied across dev/preview/prod, with version checks in card-update server actions, scoped to title and description. Brief warns: migration 0132 pending on prod; "every card-update server action needs the check"; over-aggressive checks can make autosave self-conflict.

## Verified facts (fresh this session)

- **Prod migration state — brief is STALE.** `supabase migration list --linked` (linked = prod `xndddfopnlrzkydtnjxo`, confirmed via supabase/.temp/project-ref) shows local | remote | applied all at **0133**. Nothing pending on prod. The "0132 pending, don't pile up" concern is resolved. Preview env (`tuqteqyerfdwqouofzdq`) NOT yet verified — requires re-link; defer to dispatch precondition.
- **Single server write path for title/description.** Only `updateCardImpl` writes them, via one `tx.update(cards).set(patch)` (actions/cards.ts:534). The other `.set(patch)` on cards (actions/cards.ts:855, cascade-shift) writes startDate/targetDate only. moveCard, archive, bulk ops, sprints, lists never touch title/description. "Every card-update action" collapses to ONE choke point.
- **Conflict would masquerade as "Forbidden".** `updateCardImpl` maps a zero-row update to `StructuredError("ACCESS_DENIED", "Forbidden")` (actions/cards.ts:536). A WHERE-clause version check that misses returns zero rows → stale tab shows "Forbidden". Needs a distinct conflict error (e.g. `VERSION_CONFLICT`) + client handling.

## Verified facts (carried from prior recons, spot-checked where load-bearing)

- `cards` has neither `updated_at` nor `version` (supabase/migrations/0006_lists_cards.sql). Confirmed.
- **Client edit surfaces (3, all funnel through `updateCard`):**
  1. card-modal — title saved onBlur (`persistTitle`, components/board/card-modal.tsx:662); description autosaved on 600 ms debounce (`scheduleDescSave`, :707). Both optimistic with rollback + undo bus.
  2. card-tile — inline title rename (components/board/card-tile.tsx:342).
  3. card-quick-view — deferred drafts, one combined patch on Save (components/board/card-quick-view.tsx:578-585) that may mix title/description with priority/dates/completed/type. Verified fresh.
- **Realtime:** use-board-realtime.ts:293-312 patches card UPDATEs into the store live (full-row replace) — live conflict window between teammates is small. BUT card-modal editors are local component state seeded from props; an open editor does NOT merge remote edits. The stale-tab/open-modal clobber window is real; the brief's "small value" caveat stands but is not zero.
- **Trigger interplay:** cards already carries ~15 triggers, incl. BEFORE UPDATE triggers mutating NEW (cards_set_board_id 0006, cards_sync_completed_biu 0062) and AFTER UPDATE rollups that UPDATE parent cards (0061). A bump-on-every-update trigger means a drag-move or completion bumps the version → stale tab's title save falsely conflicts. Bump must be scoped to title/description (e.g. `BEFORE UPDATE OF title, description` + `IS DISTINCT FROM` guard).
- **Naming hazard.** "Version" is an existing domain concept (release versions: 0032_versions.sql, actions/versions.ts, actions/card-versions.ts, `versionId` in board store). A bare `cards.version` invites confusion — prefer `edit_rev` or `row_version`.
- **RLS:** additive column + trigger doesn't touch policies (0006); trigger should follow existing patterns (cf. `set_card_board_id`).
- **Prior art:** 485b41d version-skew reload toast = deployment-level staleness, different layer, no overlap. 0091_card_field_history logs title changes AFTER UPDATE — useful for recovering a lost edit post-conflict; rejected updates never reach the write so history stays clean. No prior branches/attempts on card concurrency.

## Hidden scope the brief doesn't name

1. **Self-conflict is structurally real:** title onBlur and description debounce fire independent `updateCard` calls; the client must refresh its known rev from each save's returned row AND from realtime patches, or autosave conflicts with itself (the brief's feared failure).
2. **Quick-view mixed patch policy:** if a rev check rejects a mixed patch (title + priority + dates), the whole save fails. Policy needed: check applies only when the patch contains title/description.
3. **Conflict UX:** rejected save needs user-facing handling; the modal already has errorBus/retry/undo machinery to hook into.

## Scope recommendation

- **Shrink:** server-side check in ONE action (`updateCardImpl`), not "every card-update action". Trigger scoped to title/description.
- **Drop:** "migrations piling up on prod" sub-task — resolved; prod current through 0133.
- **Proceed:** migration (rev column + scoped bump trigger); rev check + `VERSION_CONFLICT` error taxonomy; client rev threading on 3 surfaces; conflict UX.
- **Clarify with stakeholder:**
  1. Conflict UX — on stale save, what should the user see? (block + toast with reload? offer overwrite? surface field history?)
  2. Column name — `edit_rev` vs `row_version` (not `version`).
  3. Quick-view mixed-patch policy (recommend: check only when title/description present).
  4. Preview env migration state — verify at dispatch.

Estimated decomposition: ~3 units (U1 migration; U2 server check + error taxonomy; U3 client threading + conflict UX). Contains a Tier 3 unit → externalized state per large-features protocol, slug `card-edit-concurrency`. Duplicate dir `concurrent-card-edits/` to be removed on Gate 0 approval.
