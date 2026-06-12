# Decomposition — card-edit-concurrency (Gate 2-F)

Status: DRAFT — awaiting Gate 2-F approval
Feature spec: [FEATURE.md](FEATURE.md) (approved Gate 1-F, 2026-06-12)

## Units

| Unit | Scope | Tier | Lane | Depends on |
|------|-------|------|------|------------|
| U1 | Migration `0134_card_edit_rev.sql`: `edit_rev integer NOT NULL DEFAULT 0` on cards + `bump_card_edit_rev` trigger (`BEFORE UPDATE OF title, description`, `IS DISTINCT FROM` guard, +1). Down-migration written. Applied to LOCAL dev via `supabase migration up`. **Gate 3.5**: down-migration EXECUTED on dev, schema verified restored, then re-applied — before U2 is built. | 3 | self | — |
| U2 | `updateCardImpl`: optional `expectedEditRev` input; when present AND patch touches title/description → `edit_rev = expected` in the WHERE; zero rows → re-select to split ACCESS_DENIED vs `VERSION_CONFLICT {currentRev, currentTitle, currentDescription}`; responses + card queries return `edit_rev`. Unit tests on the taxonomy. | 2 | self | U1 |
| U3 | Client: rev threading on card-modal (title onBlur, desc debounce), card-tile rename, quick-view (rev sent only when title/desc in patch); rev refreshed from save responses + realtime patches; ConflictDialog (keep mine → resave with fresh rev / take theirs → load server text). Two-context e2e proving the silent-clobber is dead. | 2 | self | U2 |

## Dependency map
U1 → U2 → U3 (strictly sequential; each consumes the previous unit's contract). Parallel-safety: none needed. WIP limit never exceeded.

## Tier 3 controls
- Gate 3.5 (rollback dry-run) lives INSIDE U1, before U2 dispatch.
- Cold observer before merge approval (Gate 4.5): independent agent reviews migration + server check WITHOUT the build transcript; report attached to evidence.
- Preview/prod: migration NOT applied by this feature — listed in evidence as the deploy-time step Ali triggers (supabase link + db push per env, per memory rules).

## Verification preconditions
- U1: local supabase up; `supabase migration list` clean before/after; NEVER db reset.
- U2: vitest (taxonomy tests run against impl with mocked tx or local DB role).
- U3: dev server + two browser contexts on one card (realtime.spec pattern, @innovina.it signups).

## Session plan
U1+U2 fit one session (U1 is small; 3.5 is a command sequence). U3 its own session if context is tight.
