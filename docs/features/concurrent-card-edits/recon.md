# Recon — concurrent card edit protection (optimistic locking, title/description)

Date: 2026-06-11. Tier: 3 (schema migration; prod). Frozen at Gate 0.

## Brief (as received)

Add protection against concurrent edits on cards. Cards table has no `updated_at` / `version` column. Proposal: version column + bump trigger, version check in card-update server actions, scoped to title and description. Brief claims migration 0132 pending on prod and that "every card-update server action" needs the check.

## Verified facts

- **Schema**: `cards` (supabase/migrations/0006_lists_cards.sql) has `id, list_id, board_id, title, description, position, archived, created_at`. No `updated_at`, no `version`. Brief confirmed.
- **Prod migration state — brief is STALE**: `supabase migration list --linked` (linked project = prod `xndddfopnlrzkydtnjxo`) shows local | remote | applied all at **0133**. Nothing pending on prod. The "0132 pending, don't pile up" concern is resolved.
- **Single server write path for title/description**: only `updateCardImpl` (actions/cards.ts:274) writes `title`/`description`, via one `tx.update(cards).set(patch)` (actions/cards.ts:534). Other card updates (moveCard, archive, sprints.ts, lists.ts, cards-bulk) touch position/listId/archived/sprint/completion — never title/description. `seed.ts` also calls `updateCardImpl` (single-user seeding, low risk). PMA does not write card title/description.
- **Brief vs reality**: "every card-update server action needs the version check" → with title/description scoping, exactly ONE action needs it. Blast radius smaller than briefed.
- **Client edit surfaces (3, all funnel through `updateCard`)**:
  1. `components/board/card-modal.tsx` — title saved onBlur (`persistTitle`, :662), description autosaved on 600 ms debounce (`scheduleDescSave`, :707). Both optimistic with rollback + undo bus.
  2. `components/board/card-tile.tsx:342` — inline title rename.
  3. `components/board/card-quick-view.tsx` — deferred drafts, one combined `updateCard` patch on Save (:578–585) that may mix title/description with priority/dates/completed.
- **Realtime confirmed**: `hooks/use-board-realtime.ts:293–312` patches card UPDATEs into the board store live (full-row replace). BUT the card-modal's title/description editors are local component state seeded from props — an open editor does NOT merge remote edits. The stale-tab/open-modal clobber window is real; brief's value caveat stands but is not zero.
- **Naming collision**: `0032_versions.sql` already defines a release-versions feature (`versions`, `card_versions` tables). A `cards.version` column would collide conceptually — prefer `row_version` or similar.
- **Prior art**: no prior attempts (git log/branches clean for concurrency/optimistic-locking on cards). `0091_card_field_history.sql` records field history — rejected updates must not write history (they won't; rejection precedes write).
- **RLS**: cards has RLS policies (0006). Additive column + trigger does not touch policies; trigger must be `security definer`-consistent with existing patterns (cf. `set_card_board_id`).

## Hidden scope the brief implies but doesn't name

1. **Version-bump semantics**: a bump-on-every-update trigger means card MOVES bump the version too → a stale tab's title save gets rejected because someone dragged the card. Scoped value suggests bumping only when title/description actually change (`IS DISTINCT FROM`) — spec decision.
2. **Self-conflict (brief's "too aggressive" risk) is structurally real**: title onBlur and description debounce fire independent `updateCard` calls; client must refresh its known version from each save's returned row and from realtime patches, or autosave will conflict with itself.
3. **Quick-view combined patch**: if a version check rejects a mixed patch (title + priority + dates), the whole save fails. Policy needed: check applies only when patch contains title/description.
4. **Conflict UX**: rejected save needs user-facing handling (the modal already has errorBus/retry/undo machinery to hook into).

## Scope recommendation

- Shrink: version check in ONE action (`updateCardImpl`), not "every card-update action".
- Drop: the "migrations piling up on prod" sub-task — already resolved, prod current through 0133.
- Proceed: migration (version column + scoped bump trigger) + version check + client plumbing on 3 surfaces + conflict UX.
- Clarify at spec: bump-on-any-update vs bump-on-title/description-change; column name (`row_version` vs `version`).
