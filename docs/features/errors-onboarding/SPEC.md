# errors-onboarding — SPEC

## Goal
Server actions throw coded errors; UI renders code-specific copy; demo seeder reports per-step failures to the user instead of swallowing.

## Done looks like
1. Non-member calls `renameList` → ErrorPane "Access denied — you don't have permission to change this." code `ACCESS_DENIED`.
2. Delete card in tab A, rename in tab B → "Item no longer exists — it was deleted or moved." code `NOT_FOUND`.
3. Self-link card → "Invalid action — a card can't link to itself." code `VALIDATION_ERROR`.
4. Signup with demo-seed + one forced step failure → land in `/w/:id`, sticky banner "Workspace ready. N steps couldn't complete: …" persists across reload until dismissed.
5. Clean signup → no banner.
6. Rename own list → success, no error.
7. `grep "throw new Error(" actions/` returns 0.
8. ErrorPane branches copy via `lib/errors/copy.ts` lookup keyed by code.

## Code registry (frozen)
- `ACCESS_DENIED` — RLS row not returned (was "Forbidden")
- `NOT_FOUND` — entity gone; default to `ACCESS_DENIED` when impl can't distinguish (RLS hides existence)
- `NOT_MEMBER` — workspace membership check failed
- `ROLE_INSUFFICIENT` — owner/admin gate failed
- `VALIDATION_ERROR` — input fails business rule
- `CONFLICT` — write collision
- `SEED_STEP_FAILED` — single seed step failed (context.step)
- `SEED_TEST_FAILURE` — internal forced-fail
- `SEED_PARTIAL` — UI-side wrapper for partial seed report (context.failedSteps)
- `ACTION_FAILED` — fallback

## Must not change
- M1. Impl logic — same throw points, same conditions, same SQL/tx.
- M2. Exported action names + caller TS contract — either preserved or callers updated in same unit.
- M3. Auth/session/redirect flow in callback route.
- M4. RLS semantics — no info-leak via NOT_FOUND vs ACCESS_DENIED.
- M5. errorBus public API additive only.
- M6. ErrorPane fixed-position bottom bar, retry, dismiss, clear — visual contract identical.
- M7. seedDemoWorkspaceImpl signature + SeedResult shape.
- M8. Existing tests pass.
- M9. Demo seed remains best-effort — partial failure does not block.
- M10. No new prod deps.

## Tier
2 (shared) — all 6 gates required.

## Blast radius
~30 files. ~600-900 LOC. Touches every server action wrapper + every errorBus call site + auth callback + new banner mount.

## Out of scope
- i18n
- Settings → retry-failed-seed-steps button
- Sentry / observability
- Non-action throws in lib/ or app/api/
