# Wave 2 — Dispatch 1b, 2, 3a, 3b (parallel)

**Date**: 2026-05-14
**Branch**: plan/01-foundation
**Orchestrator**: Claude (Opus 4.7)
**Status**: COMPLETE (all four dispatches green; integration DB tests blocked by pre-existing 0097 bug — out of scope)

## Dispatches

| Dispatch | Agent id | Duration | Result |
|---|---|---|---|
| 1b — Sub-board UI scrub + Epic UI removal | `a74f3b674a2728714` | ~526s | success |
| 2 — Security baseline | `a2e871c5902bd1401` | ~478s | success |
| 3a — DB indexes | `a23b9cab67dbe7873` | ~295s | success (latency unmeasured) |
| 3b — Pool config | `a6616ff998ade8200` | ~323s | success |

All four ran foreground in parallel (single Agent batch).

## Per-dispatch summary

### 1b — Sub-board UI scrub
- Deleted `components/epic/*` (4 files).
- Deleted route `app/(app)/w/[workspaceId]/e/[epicId]/page.tsx`.
- Type picker: removed Epic option; locked type in edit mode with "Type is fixed at creation" affordance.
- Scrubbed Epic refs from `card-modal.tsx` + `card-quick-view.tsx`; preserved pre-existing WIP edits.
- Deleted `tests/unit/group-children-by-status.test.ts`.
- Updated seed scripts (`scripts/seed-aiwepi*.mjs`) to stop emitting `type='epic'`.
- Scrubbed Epic terms in old dated docs (2026-05-11 .. 2026-05-13); left current spec untouched.
- New tests: `tests/unit/epic_migration_ui.test.ts` (3 tests, all PASS).
- `subboards_enabled` flag plumbing **deferred** — repo has no flag system; designing one exceeded 1b's writeset.
- Open follow-up: `actions/seed.ts` still references Epic (outside writeset); 368 grep hits remain in roadmap/workspace surfaces / integration tests outside writeset.

### 2 — Security baseline
- Re-enabled `0056_auth_domain_allowlist.sql` (rename from .disabled) — updated to current Supabase Before-User-Created hook shape.
- Re-enabled `0057_storage_rls.sql` (rename from .disabled) — bucket-scoped Storage policies.
- `lib/supabase/middleware.ts`: added unauthenticated gate for `/dashboard/**` (302 → /login?next=…) and `/api/internal/**` (401 JSON).
- New `lib/notifications/email-labels.ts` — single source for kind→label mapping; `lib/notifications/email-digest.ts` migrated to import.
- 6 tests across `security-middleware.test.ts` + `security-baseline-sql.test.ts`, all PASS.
- Open follow-up: 5 callers outside writeset still maintain their own kind→label maps — listed for downstream dispatch.
- Manual prod step required: Supabase Dashboard → Authentication → Hooks → Before User Created → wire `public.auth_block_external_domains`; confirm `allowed_domains` list; run `0057` manually in Studio if `db push` cannot create `storage.objects` policies.

### 3a — DB indexes
- Migration `0101_indexes_notifications_unread.sql`: partial index on `notifications (recipient_user_id, read_at, created_at DESC) WHERE read_at IS NULL`.
- Card field history: existing `(card_id, changed_at DESC)` index already covers the hot query — no new index added.
- Board activity: existing `activity (board_id, created_at DESC)` and `(card_id, created_at DESC)` already cover — no new index added.
- `tests/integration/db-indexes.test.ts` added.
- Latency: **could not measure** — sandbox blocked direct Postgres access (`connect EPERM 127.0.0.1:54322`). Index plan asserted only by name in test, not by ANALYZE.

### 3b — Pool config
- `lib/supabase/server.ts`: kept `@supabase/ssr` cookie-based RSC/route-handler client; added zod env validation; cookie writes safe for RSC.
- `lib/supabase/browser.ts`: added zod validation; memoized browser anon client.
- `.env.local.example`: documented all five env keys (URL, anon, service-role, pooler `:6543`, direct migration URL).
- `vercel.json`: minimal, added rationale comment.
- New test `tests/unit/supabase-client-env.test.ts` — PASS.
- Note: raw SQL pooling lives in `lib/db/client.ts` (outside writeset) using `DATABASE_URL` — left untouched; flagged for future dispatch.

## Wave Gate
| Check | Result |
|---|---|
| `npm run type-check` | PASS (was failing post-Wave-1; 1b's deletions restored it) |
| `npm run lint` | PASS |
| `npm run test:unit` (focused on new tests) | All Wave 2 dispatch tests PASS |
| `npm run test:unit` (full suite) | Pre-existing schema-drift failures (122 integration tests fail because local DB is stuck pre-0099 due to 0097 bug). Not introduced by Wave 2. |
| Writeset disjoint vs Wave 3 (3c + 4) | YES — 3c touches actions/cards.ts (archive path) + actions/sprints.ts; 4 touches app/(app)/**/layout.tsx, new lib/queries/*, stores/*, components/board/board-view.tsx, components/roadmap/roadmap-view.tsx. No overlap with any Wave 2 writeset. |

## Carry-over
- Migration 0097 SQL bug — pre-existing, blocks `npm run db:reset` and any integration tests. Affects Waves 1/2/3. Out of every dispatch's writeset. Needs a separate hotfix dispatch.
- `actions/seed.ts` Epic references — flagged by 1b, left for follow-up.
- 5 notification-label drift sites outside `lib/notifications/**` — flagged by 2, left for follow-up.
- `lib/db/client.ts` raw-SQL pool config using `DATABASE_URL` instead of `SUPABASE_DB_URL` — flagged by 3b, optional follow-up.
- `subboards_enabled` flag system — deferred by 1b; dispatch 4 implemented its own `NEXT_PUBLIC_SHARED_WORKSPACE_CACHE` env-var fallback for its flag — there is no unified workspace flag mechanism yet.
