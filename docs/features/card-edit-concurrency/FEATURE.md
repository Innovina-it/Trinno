# FEATURE — card-edit-concurrency (Gate 1-F)

Status: ACCEPTED at Gate 4 by Ali, 2026-06-12 (U1 13188f8, U2 9a70e29, U3 9c43976+ccff1f8, quick-view fix cfd54b5, label d8b4c9b). Migration applied to local dev only — preview/prod at Ali's deploy.
Tier: 3 (schema migration on the hot `cards` table; destined for prod)
Recon: [recon.md](recon.md), approved Gate 0 2026-06-12

## Goal

Optimistic-concurrency protection for card **title and description**: an `edit_rev` counter on cards, bumped by a trigger ONLY when title/description actually change; the single server write path (`updateCardImpl`) rejects stale writes with a dedicated `VERSION_CONFLICT` error; the three client edit surfaces thread the rev and, on conflict, show the chosen dialog — "X changed this while you were typing — keep yours or take theirs?".

## Done looks like (observable)

1. Two sessions on the same card: A saves a new title; B (stale) saves → B gets the conflict dialog naming the field. "Keep mine" re-saves over it (with the fresh rev); "Take theirs" loads the server text into B's editor. Nothing is ever lost silently.
2. Description autosave (600 ms debounce) and title onBlur never self-conflict: the client refreshes its known rev from every save response and from realtime patches.
3. Dragging a bar, moving lists, completing, priority, labels — none of it bumps `edit_rev`; a stale tab's title save still goes through after those.
4. Quick-view batched Save: the rev check engages only when the patch contains title/description; pure field patches (priority/dates) behave exactly as today.
5. A real permission denial still reads "Forbidden"; only genuine rev mismatches read as conflict.
6. Migration applied to LOCAL DEV only in this feature; the down-migration is written and EXECUTED on dev as the Gate 3.5 rollback dry-run. Preview/prod application happens at Ali's deploy, never autonomously.

## Must not change

- `updateCardImpl` behavior when `expectedEditRev` is NOT supplied — the check is opt-in per call; all other callers (undo closures, seeds, PMA, bulk, drag) keep today's last-write-wins semantics. (Documented limitation: undo of a title write does not rev-check; the 10-minute undo window bounds it — accepted at the undo feature.)
- The ~15 existing triggers on cards (set_board_id, completed mirror, parent rollups) — the bump trigger is additive, `BEFORE UPDATE OF title, description` + `IS DISTINCT FROM` guard.
- Realtime full-row replace (rows now carry edit_rev; consumers ignore unknown fields).
- RLS policies untouched (additive column + trigger only).
- Release-versions feature (`versions`, `card_versions`) — separate concept, untouched; hence the name `edit_rev`, never `version`.
- Field-history logging (0091) — rejected writes never reach it.

## Conflict error contract

`StructuredError("VERSION_CONFLICT", { currentRev, currentTitle, currentDescription })` — carries the server's current text so the dialog can offer "take theirs" without a refetch. Zero-row update now re-selects to distinguish: row missing/RLS → ACCESS_DENIED (as today); rev mismatch → VERSION_CONFLICT.

## Units (Gate 2 decomposition to confirm)

- **U1 — migration** (Tier 3): `edit_rev integer NOT NULL DEFAULT 0` + scoped bump trigger; down-migration; applied to dev; rollback dry-run = Gate 3.5.
- **U2 — server check** (Tier 2): `expectedEditRev` input on updateCardImpl, conflict taxonomy, return edit_rev in update responses + card queries.
- **U3 — client threading + dialog** (Tier 2): card-modal (title onBlur + desc debounce), card-tile rename, quick-view mixed patch; keep-mine/take-theirs dialog wired to errorBus patterns; rev refresh from saves + realtime.

## Verification preconditions

- Two browser contexts on the same card (conflict simulation) — e2e-able with the existing two-context pattern (realtime.spec style).
- Local supabase running; `supabase migration up` on dev only; memory rule: NEVER `db reset`.
- Cold observer (Tier 3): independent agent reviews migration + check without the diff context before merge approval (Gate 4.5).
