# Sheet1 Task Triage — Claude Execution Plan

**Date**: 2026-05-14
**Source**: `tasks/Sheet1.html`
**Goal**: Convert the sheet into a Claude-ready engineering prompt and an execution order that separates parallel work from standalone/high-risk work.
**Status**: Revised (v2 — adds file ownership, Phase 0 decisions, feature flags, rollback, perf targets, Epic-grep allowlist, 15-dispatch split)

---

## Claude Master Prompt

Use this prompt when starting a new Claude session for this task set:

```text
You are working in the Trinno / trello-foundation repository, a Next.js + Supabase application with board, roadmap, task, workspace, notification, and auth features.

Your job is not to implement every Sheet1 task at once. First, triage the work, then implement only the assigned slice. Preserve existing behavior outside the assigned slice. Do not perform large unrelated refactors.

Before editing:
1. Inspect the relevant files and existing patterns.
2. Identify whether the assigned task touches schema, auth, shared data loading, board/roadmap UI, card modal logic, or minor UI polish.
3. Check for conflicts with related Sheet1 tasks, especially:
   - The target product language is **sub-board**: a board with a parent board. Remove the old **Epic** concept completely from product behavior, UI language, creation flows, task types, docs, and dead compatibility code. Existing Epic data should be migrated/mapped into sub-boards, not preserved as a visible concept.
   - Cross-tab auth sync appears in two tasks and should be unified into one implementation.
   - Board/Roadmap shared data loading affects several smaller Board/Roadmap refresh/navigation issues.
4. Produce a short implementation plan with files, risk level, and tests.

Implementation rules:
- Keep changes scoped to the assigned task group.
- Follow existing repository conventions for server actions, Supabase clients, queries, components, and migrations.
- Add or update tests where the behavior is risky, shared, or regression-prone.
- For database changes, add migrations and verify RLS/index behavior.
- For auth/security changes, verify direct API access, unauthenticated redirects, and logged-in behavior.
- For UI changes, verify desktop and mobile behavior, and make sure text/buttons do not overlap.
- For performance tasks, measure before/after when possible and document what was measured.
- For Epic removal, search for `epic`, `Epic`, `EPIC`, `type='epic'`, route names, labels, seed data, migrations, helpers, tests, and docs. Remove or migrate every relevant usage so the concept no longer appears in the app unless a historical database migration comment requires it.

Definition of done:
- Acceptance criteria for the assigned task group are met.
- Expected result and improvement criteria are explicitly confirmed.
- Lint/typecheck/targeted tests pass or any inability to run them is explained.
- The final response lists changed files, tests run, a concrete test case, expected vs actual result, and any follow-up risks.

Do not start broad architecture tasks in parallel with tasks that depend on them. If you discover a product conflict, stop and write the decision needed instead of guessing.
```

---

## Highest-Level Interpretation

The sheet contains four different kinds of work:

1. **Product decisions / breaking architecture**: sub-board model replacing and removing all old Epic behavior, shared workspace data loading, auth/session sync, role model, service/client architecture.
2. **High-value backend/security/performance**: Supabase pooling, bulk updates, disabled security migrations, middleware auth gate, indexes, lazy card history.
3. **Board/Roadmap/Card workflow bugs**: task type mutation, sub-board creation/defaults, removal of old Epic flows, default board/list behavior, backlog movement, roadmap return behavior, shared workspace refresh, rank collision.
4. **Small UI polish / clarify items**: close button layout, task type highlight, date picker opening, labels cleanup, mine-filter badge, unassigned visibility, guest notifications/assignment questions.

The dangerous part is that some items mix old and new product language. The desired direction is **sub-boards**: boards with a parent board. The old **Epic** concept should be removed from the product, including visible labels, card type options, creation/edit flows, route concepts, seed concepts, and old helper logic. Existing Epic data should be migrated or mapped into sub-boards so no user-facing Epic concept remains.

---

## Do First

These should happen before most implementation because they unblock or prevent rework.

| Order | Task Group | Why First | Expected Result / Improvement Criteria | Mode |
|---|---|---|---|---|
| 1 | Sub-board model and Epic removal | Many Very High/High fixes depend on this. The product should no longer expose or extend Epic concepts. | A board can contain sub-boards; existing Epic data is migrated/mapped; no user-facing Epic labels, task types, creation flows, or docs remain. | Standalone product/architecture decision + implementation |
| 2 | Security baseline: enable/check `0056_auth_domain_allowlist.sql.disabled`, `0057_storage_rls.sql.disabled`, add middleware protection for `/dashboard` and `/api/internal` if still missing | Security changes should not wait behind UI polish. Existing disabled migrations are explicit risk. | Unauthenticated protected routes/API calls are blocked; storage RLS is active; signup/domain behavior is explicit; email kind labels have one source of truth. | Standalone or one focused security agent |
| 3 | Shared workspace data-loading architecture | Board/Roadmap navigation, stale refresh, filters, and performance depend on one cache/data source. | Board/Roadmap switch without reload flicker; shared mutations stay synchronized; duplicated fetches are removed. | Standalone breaking refactor |
| 4 | Cross-tab auth/session strategy | Appears twice in the sheet. Should be one unified implementation, not two separate BroadcastChannels fighting each other. | Login/logout/token refresh syncs across tabs quickly without refresh loops or stale sessions. | Standalone breaking refactor |
| 5 | Database performance quick wins: indexes + connection pool config audit | Low product ambiguity, high operational value. Indexes can land early. Pool changes may need env/deploy coordination. | Unread notification, card history, and activity queries stay fast; bulk operations avoid row-by-row network loops; pool settings are ready for concurrent load. | Parallel with security if file ownership is separate |

---

## Standalone Work

Do these alone because they are broad, risky, or likely to cause merge conflicts.

| Task Group | Includes | Expected Result / Improvement Criteria | Notes |
|---|---|---|---|
| Sub-board hierarchy refactor and Epic removal | Implement **sub-boards** as boards with a parent board. Add/adjust the data model, creation flow, parent-board selector, default-list setup, navigation, and labels around sub-boards. Remove the old Epic task type, Epic-specific creation/edit flows, Epic labels, and dead Epic helpers. | Users create/open/manage sub-boards, not Epics. Searching the codebase for Epic terms should only find historical migration notes or intentionally retained data-migration comments. | This is the first implementation slice. Migrate data safely, but remove the concept from the app. |
| Unified workspace data loading | Layout-level fetch, TanStack Query/shared cache, BoardView/RoadmapView consuming same data, tab navigation | Switching Board/Roadmap is instant or near-instant; no visible spinner flicker; mutation results appear in both views without refresh. | Must land before optimizing many Board/Roadmap refresh issues. |
| Board virtualization | `@tanstack/react-virtual`, DnD compatibility, 500+ cards, dragged element persistence | Board scroll/drag remains fluid with 500+ cards; dragged card remains stable even if virtualized source row changes. | High UI risk. Do after shared cache/data shape stabilizes. |
| Cross-tab auth/session sync | Supabase localStorage persistence, `storage` listener, `BroadcastChannel`, token refresh loop prevention, tab ID if needed | Logout/login/token refresh syncs across tabs within the target window and does not create duplicate refresh storms. | Merge duplicate Sheet1 requirements into one design. |
| Technical debt architecture | Central service-role Supabase client, generated DB types, service extraction | Duplicate service-role client initializations are removed; database operations use generated types; fat server actions move toward testable services. | Good foundation, but broad. Avoid mixing with feature fixes unless the fix requires it. |
| Unified workspace roles | `workspace_roles`, JSONB capabilities, `hasCapability`, Board/Roadmap consistency | Permissions behave consistently across Board and Roadmap; capability checks are centralized and extensible. | Low priority but large schema/auth surface. Do late. |
| Subtask parent completion workflow | Remove forced auto-complete, add confirmation dialogs, bidirectional status prompt, audit logs | Parent cards never move to Done without explicit confirmation; reopened subtasks can prompt parent status rollback; history records both events. | Touches card state, columns, subtasks, audit/activity. Better as one focused slice. |
| User preferences persistence | `user_preferences`, provider, debounced write-back, layout flicker prevention | Sidebar, filters, active tab, layout density, sort, and roadmap zoom persist across devices without visible layout snapping. | Cross-app state. Do after shared layout/cache decisions. |
| Lazy card history | Remove history from initial card detail fetch, add paginated history fetcher and lazy UI | Initial card modal payload is smaller; activity/history loads on demand with pagination and skeleton feedback. | Can be standalone, but coordinate with card modal changes. |

---

## Parallel Batches

### Batch A — Backend/Security/DB

Can run in parallel if each worker owns a narrow file area.

| Task | Parallel Safety | Expected Result / Improvement Criteria | Dependencies |
|---|---|---|---|
| Add missing DB indexes for notifications, card history, board activity | High | Target queries use appropriate indexes and remain fast with large tables; migration is additive and reversible. | None, but check existing migrations first |
| Security migrations + middleware gate + email label consolidation | Medium | Protected routes reject unauthenticated users; storage policies are active; notification labels cannot drift between email/UI code. | Should run early; coordinate with auth sync |
| Supabase pooling + bulk archive + sprint date batch update | Medium | Pool config supports higher concurrency; archive/date-shift operations use batch updates instead of per-row network loops. | Can parallel with indexes, but avoid colliding with technical-debt service extraction |
| Lazy card history loading | Medium | Card detail opens faster because history/activity is paginated and loaded only when requested/visible. | Coordinate with card modal UI work |
| Structured errors + seed reporting | High | Users see specific error states; seeding reports partial success/failure instead of hiding failures. | Low priority, separate files likely |

### Batch B — Board/Card Workflow Fixes

Run after the sub-board model and Epic-removal implementation. Do not add new Epic behavior; remove old Epic paths or convert them into sub-board behavior.

| Task | Parallel Safety | Expected Result / Improvement Criteria | Dependencies |
|---|---|---|---|
| Disable Task/Bug/type changes in edit mode | High | Existing cards cannot be mutated into structurally incompatible types after creation. | None |
| Remove due date from task creation if it duplicates task end date | High | Creation UI/data no longer stores redundant due date when end date already represents that value. | None |
| Default lists for new boards | Medium | Every new board/sub-board starts with expected default lists such as Todo/In Progress/Done. | Coordinate with seed/default board template code |
| Default subtask owner to parent task owner | High | New subtasks inherit the parent task owner unless explicitly changed. | None |
| Cannot click `T1.1` / click falls through | Medium | Clicking the task opens the correct detail view/modal and no longer behaves as empty space. | Coordinate with card modal/intercept route work |
| Sub-board creation success feedback | Medium | Sub-board and task creation messages always include the actual target board/sub-board. No old Epic creation path remains. | Requires sub-board implementation |
| Backlog menu cannot move task from Backlog to other list | Medium | Users can move backlog tasks to valid board lists from the backlog menu. | May touch list/card movement actions |
| Opening Story with type Task not highlighted | High | The active type/status control reflects the saved task type correctly. | UI-only likely |
| Story detail should show subtask list instead of only count | Medium | Card detail shows actual subtask rows/titles plus progress, not only `0/2` style summary. | Coordinate with card modal work |
| Fix close button layout | High | Close button aligns consistently and does not overlap modal/card content. | UI-only |
| Date component click should also open date picker | High | Clicking the date area supports both direct editing and picker selection. | UI-only component work |

### Batch C — Roadmap/Workspace UI Fixes

Best after shared workspace data-loading is decided or implemented.

| Task | Parallel Safety | Expected Result / Improvement Criteria | Dependencies |
|---|---|---|---|
| Roadmap detail should return to Roadmap, not Board | Medium | Opening and closing details from Roadmap preserves the user's Roadmap context. | Depends on routing/navigation model |
| Lane name click redirects to 404 | High | Lane-name clicks navigate to a valid destination or become non-clickable if no destination exists. | Roadmap route/link fix |
| Lane ordering rank collision | Medium | Reordering lanes no longer fails with rank collision under normal concurrent/local reorder cases. | Touches sparse rank/order logic; test carefully |
| Mine filter badge: show more cards exist in Roadmap | Medium | Users know when the current filter hides additional roadmap cards. | Needs filter semantics |
| Show unassigned tasks everywhere | Medium | Unassigned cards/tasks appear consistently wherever filters say they should. | Needs filter semantics |
| Shared workspace board creation visible without refresh | Medium | Board selectors and related views update after board creation without manual refresh. | Better after shared cache/realtime strategy |
| ~~Guest shared workspace~~ (moved to Batch D — Clarify, see D0.3) | — | — | Implement only after D0.3 lands |

### Batch D — Clarify / Product Cleanup

Do not implement until clarified.

| Task | Expected Result / Improvement Criteria | Needed Decision |
|---|---|---|
| Remove `C` command for quick add | Keyboard shortcuts no longer surprise users or conflict with text entry. | Confirm whether to remove globally, only Board, or replace shortcut |
| Remove labels like Regression/Crash/data-loss/ui perf | Label set is simpler and matches actual product taxonomy. | Confirm whether remove seed labels, hide label templates, or delete existing labels |
| Hidden / out of scope Sprint item | No implementation until scope is explicit. | Keep out of scope |
| Guest user notifications, home info, assignment | Shared workspace guests have predictable permissions and notifications. | Clarify expected guest permissions before coding |
| Empty all Version Data | Version-related cleanup happens in the intended place without accidental data loss. | Clarify whether this means delete seed version data, remove versions from DB, or clear a specific workspace |

---

## Phase 0 Decisions (must be written before any dispatch runs)

These are the product/architecture answers Phase 1+ depend on. Each decision must be checked in to this doc (or linked from it) before its dependent dispatch starts. **No decision = no dispatch.**

### D0.1 — Epic → sub-board mapping rule

- **Question**: How does existing `type='epic'` data become sub-boards?
- **Required output**: One of:
  - **1:1 lift**: each Epic row becomes one sub-board with the same parent board and title. Children tasks re-parent to the sub-board.
  - **Group lift**: Epics inside the same parent board collapse into a single sub-board only if title-equal.
  - **Manual review**: migration produces a report; product chooses per row.
- **Default if undecided**: 1:1 lift, reversible migration (`down` recreates Epic rows from sub-board rows tagged `_migrated_from_epic_id`).
- **Owner**: product + dispatch 1a.

### D0.2 — Epic-grep allowlist

Paths/strings that are allowed to retain `epic`/`Epic` references after removal (historical context):

- `supabase/migrations/00[0-9][0-9]_*.sql` — historical migrations stay as written.
- Any migration whose filename contains `epic_to_subboard` or `_migrated_from_epic_` — required for traceability.
- `CHANGELOG.md` and existing dated entries in `docs/`.
- Test fixture names like `epic_migration_*.test.ts` proving the migration works.
- Variable name `MIGRATED_FROM_EPIC_ID` if used as a column comment or constant.

Everything else: remove or rename.

### D0.3 — Guest / shared-workspace permission matrix

- **Question**: What can a guest member do?
- **Required output**: matrix with rows {view home, view boards, create card, assign self, assign others, receive notifications, mention} × columns {owner, admin, member, guest, public-link}.
- **Default if undecided**: guest = read-only on Home + assigned boards; can comment on cards assigned to them; receives notifications only for direct mentions/assignments.
- **Owner**: product + dispatch 10.

### D0.4 — "Empty all Version Data"

- **Question**: Which scope? Seed-only? Per-workspace? Global delete?
- **Required output**: explicit scope plus list of tables touched.
- **Default if undecided**: out of scope until owner specifies. Do not implement.

### D0.5 — Keyboard shortcut `C`

- **Question**: Remove globally, scope to Board only, or remap?
- **Default if undecided**: scope to Board context only; suppressed when focus is inside `input`, `textarea`, or `[contenteditable]`.

### D0.6 — Cross-tab auth event contract

- **Question**: What event names and payloads cross tabs?
- **Required output**: a single `BroadcastChannel` name (`trinno-auth-v1`) and event union: `'signed-in' | 'signed-out' | 'token-refreshed' | 'session-expired'`. No second channel allowed.
- **Default if undecided**: above contract.
- **Owner**: dispatch 5.

### D0.7 — Sub-board rollout strategy

- **Question**: Big-bang or feature-flagged?
- **Default if undecided**: feature flag `subboards_enabled` (workspace-level). Old Epic UI removed code-wise but new sub-board UI gated. Migration runs always; flag controls visibility.

---

## Recommended Phase Plan

### Phase 0 — Recon and Decisions

1. Resolve D0.1 through D0.7 above. Write answers into this doc.

### Phase 1 — Security and Operational Baseline

1. Enable or replace disabled security migrations.
2. Add/verify middleware gate for protected paths.
3. Centralize email notification kind labels.
4. Add missing performance indexes.
5. Confirm Supabase pooler config path and deployment variables.

### Phase 2 — Data/Architecture Foundation

1. Shared workspace data loading and cache.
2. Cross-tab auth/session sync.
3. Optional: central service-role client and generated DB types if needed before larger DB work.

### Phase 3 — High-Priority Workflow Bugs

1. Task type locked in edit mode.
2. Sub-board creation, parent-board selection, and default-list behavior.
3. Remove duplicated due date during creation.
4. Default lists on board creation.
5. Default subtask owner from parent task owner.
6. Backlog list movement.

### Phase 4 — Card Modal and Roadmap UX

1. T1.1 click/card modal routing.
2. Task type highlight.
3. Subtask list display.
4. Lazy activity/history loading.
5. Roadmap back navigation.
6. Lane 404 and rank collision.

### Phase 5 — Performance and Persistence

1. Bulk archive and sprint date batch updates.
2. ~~Board virtualization~~ (moved to Phase 2.5 — depends on shared cache landing in Phase 2; runs immediately after).
3. User preferences persistence.
4. Date component behavior.

### Phase 2.5 — Board virtualization (inserted)

Runs after Phase 2 shared cache stabilizes, before Phase 3 workflow bugs touch the same board components. Reason: virtualization changes the DOM shape that workflow-bug fixes rely on; doing it later forces rework.

### Phase 6 — Low-Priority Polish and Clarified Items

1. Close button layout.
2. Structured errors and seed reporting.
3. Label cleanup.
4. Mine-filter badge and unassigned visibility.
5. Guest/shared workspace fixes after role decisions.

### Phase 7 — Large Low-Priority Refactor

1. Unified workspace role model.
2. Service extraction if not already completed.

---

## Expected Results by Phase

| Phase | Expected Result | Improvement Criteria |
|---|---|---|
| Phase 0 | Product ambiguity is removed before coding. | Sub-board/Epic-removal, guest permissions, Version cleanup, and shortcut behavior have explicit decisions. |
| Phase 1 | App security and DB baseline are stronger. | Protected routes are gated, storage RLS is active, notification labels are centralized, and high-traffic queries have indexes. |
| Phase 2 | Shared data and auth foundations are stable. | Board/Roadmap avoid duplicate fetches; tabs share auth state without stale sessions or refresh loops. |
| Phase 3 | Core task creation/edit workflows behave correctly. | New boards/sub-boards have defaults; task types cannot mutate into invalid shapes; backlog movement and owner defaults work. |
| Phase 4 | Card and Roadmap UX regressions are fixed. | Details open/close in the right context; subtasks and type state render correctly; roadmap links/order actions stop failing. |
| Phase 5 | Heavy workflows are faster and persistent. | Bulk operations are batched; large boards stay fluid; preferences survive devices; date picker behavior is intuitive. |
| Phase 6 | Low-priority polish and clarified items are resolved. | UI polish, filters, labels, errors, and guest behavior match product decisions. |
| Phase 7 | Long-term authorization/architecture is cleaner. | Capability checks and service layers are centralized enough to reduce future drift. |

---

## Performance Targets (measurable acceptance)

Numeric thresholds replace fuzzy "instant / near-instant" language. Each must be measured before/after and reported in the completion report.

| Area | Metric | Target | How to measure |
|---|---|---|---|
| Board↔Roadmap tab switch | Visible content swap (no spinner) | p95 < 100 ms, no network call | DevTools Network + Performance, repeat 10× |
| Card modal open | Initial paint (without history) | p95 < 250 ms | DevTools, cold + warm cache |
| Card modal history fetch | Lazy load on scroll/click | p95 < 400 ms for first 20 rows | Network panel timing |
| Notifications unread query | DB latency | p95 < 50 ms with index | Supabase logs / `EXPLAIN ANALYZE` |
| Card field history query | DB latency | p95 < 80 ms with index | `EXPLAIN ANALYZE` |
| Board with 500+ cards | Scroll FPS | ≥ 55 fps sustained | Chrome Performance recording |
| Bulk archive (100 cards) | End-to-end | < 1.5 s | Wall clock from action |
| Sprint date shift (100 cards) | End-to-end | < 1.5 s | Wall clock |
| Cross-tab auth event delivery | Tab A logout → Tab B sees it | < 500 ms | Two-tab manual test, log timestamps |
| Token refresh storm | Concurrent refreshes per minute | ≤ 1 per 50 min window | Network panel filter on `/auth/v1/token` |

If a target cannot be measured (no instrumentation), the agent must state so explicitly and propose what instrumentation is missing.

---

## Feature Flags and Rollback

Risky changes ship behind flags. Each flag has an owner, default, and rollback procedure.

| Flag | Scope | Default | Controls | Rollback |
|---|---|---|---|---|
| `subboards_enabled` | workspace | off in prod, on in staging | Sub-board UI visibility; data migration runs regardless | Toggle off; Epic UI is already removed, fallback is "boards only" view; no data loss because sub-board rows survive |
| `virtualized_board` | workspace | off | `@tanstack/react-virtual` wrapping of list columns | Toggle off → falls back to non-virtualized rendering; DnD path identical |
| `shared_workspace_cache_v2` | workspace | off | Layout-level fetch + shared TanStack cache | Toggle off → views fall back to per-page fetches (current behavior) |
| `auth_broadcast_v1` | global | on | Single `BroadcastChannel('trinno-auth-v1')` | Toggle off → tabs revert to no-sync (current state pre-fix) |
| `lazy_card_history` | global | off | Removes history from card detail initial payload | Toggle off → restore eager fetch |

**Rollback for disabled security migrations (`0056_auth_domain_allowlist.sql.disabled`, `0057_storage_rls.sql.disabled`):**

1. Apply on staging first. Run full smoke suite (login, signup, storage upload/download, RLS-gated reads).
2. Capture EXPLAIN plans for top 5 storage queries before/after.
3. Production rollout: apply in maintenance window; have `down` migration drafted that drops the new policies and re-disables (rename back to `.disabled`).
4. Monitor Supabase logs for `permission denied` spikes for 1 hour post-apply.
5. If spike > baseline + 2σ → run down migration immediately.

---

## File Ownership Matrix

Each agent owns a non-overlapping set of paths. **Two agents may not write the same file in the same parallel batch.** Coordination items (shared types, generated DB types) land in dispatch 1a or dispatch 4 first and are read-only for downstream agents.

| Dispatch | Owns (write) | Reads (no write) | Notes |
|---|---|---|---|
| 1a Sub-board data model + migration | `supabase/migrations/0099_*..010X_*.sql`, `lib/db/types.ts`, `lib/epic/*` (delete or rename to `lib/subboard/*`), `actions/cards.ts` (type='epic' paths only) | rest of `lib/`, `actions/boards.ts` | Lands first. Sole writer of new migrations until merged. |
| 1b Sub-board UI scrub | `components/epic/*` (delete), `components/board/new-card-dialog.tsx` (type picker), `components/board/card/type-picker.tsx`, `components/board/card-modal.tsx` (Epic refs), `components/board/card-quick-view.tsx` (Epic refs), `docs/superpowers/specs/` (Epic terms in old specs only if dated), seed code, route segments | DB types from 1a | Runs after 1a merges. Same agent OK or handoff. |
| 2 Security baseline | `middleware.ts`, `lib/supabase/middleware.ts`, `supabase/migrations/0056_*`, `0057_*` (re-enable), `lib/notifications/email-labels.ts` (new) | `app/api/internal/*` (read for path enumeration) | Must land before 5. |
| 3a DB indexes | `supabase/migrations/01XX_indexes_*.sql` only | none | Pure additive migrations. |
| 3b Pool config | `lib/supabase/server.ts`, `lib/supabase/browser.ts`, `.env.local.example`, `vercel.json` | none | Env-coordinated. |
| 3c Batch updates | `actions/cards.ts` (archive path), `actions/sprints.ts` (date shift) | none | Strict surgical edits; do not touch unrelated paths in same files. |
| 4 Shared workspace data | `app/(app)/**/layout.tsx`, `lib/queries/*` (new), `stores/*` (workspace cache), `components/board/board-view.tsx` (consume), `components/roadmap/roadmap-view.tsx` (consume) | DB types from 1a | Blocks 6/7/8. |
| 5 Cross-tab auth | `lib/supabase/browser.ts` (storage events only), `app/(auth)/*` providers, new `lib/auth/broadcast.ts` | middleware from 2 | Reads `auth_broadcast_v1` flag. |
| 6a Type lock + due date | `components/board/card/type-picker.tsx` (lock in edit), `components/board/new-card-dialog.tsx` (drop duplicate due date) | sub-board types from 1a | After 1b. |
| 6b Defaults | `actions/boards.ts` (default lists), `actions/cards.ts` (subtask owner default), `lib/board-templates.ts` | none | After 1a. |
| 6c Backlog movement | `components/board/bulk-action-bar.tsx` (backlog menu), `actions/lists.ts` move paths | none | Can parallel with 6a/6b. |
| 7 Card modal/history | `components/board/card-modal.tsx`, `components/board/card-quick-view.tsx`, `lib/queries/card-history.ts` (new) | shared cache from 4 | After 4. |
| 8 Roadmap fixes | `components/roadmap/roadmap-view.tsx`, `components/roadmap/roadmap-row-handle.tsx`, `components/roadmap/use-roadmap-drag-harness.ts`, `lib/roadmap/*`, navigation back-stack helper | shared cache from 4 | After 4. |
| 9a Virtualization | `components/board/list-column.tsx`, `components/board/board-view.tsx` (virt wrapper), new `components/board/virtualized-list.tsx` | shared cache from 4 | Phase 2.5; gated by `virtualized_board` flag. |
| 9b User prefs | `supabase/migrations/01XX_user_preferences.sql`, `actions/profile-*.ts` (new prefs action), provider in `app/(app)/layout.tsx` | layout from 4 | Coordinate with 4 on layout touch. |
| 9c Date component | `components/ui/date-picker.tsx`, callers in board/roadmap (minimal edits) | none | Small surface. |
| 10 Cleanup/clarified | label seed, `command-palette.tsx` (`C` shortcut), `lib/errors/*`, seed reporting, guest-perm code (post D0.3) | role/permission helpers | Last. |

**Conflict resolution:** if two dispatches need to write the same file, the earlier-phase dispatch wins and the later one rebases. Never start a parallel dispatch without confirming its writeset is disjoint from currently-running dispatches.

---

## Codex Agent Dispatch Plan (revised: 15 dispatches)

Original plan had 10 dispatches. Doubling to 20 was considered and rejected: max parallelism is still 4 (file collision risk), and overly-fine splits fragment cross-cutting concerns (e.g. sub-board product language must stay consistent). Split selectively where files are orthogonal; keep cohesive where they aren't.

**15 dispatches, max 4 parallel.** Critical path: 1a → 1b → 4 → {6,7,8 parallel}. Total wall time bound by that chain, not by agent count.

| Dispatch | Agent | Run rule | Ownership (summary) |
|---|---|---|---|
| 1a | Sub-board data model + Epic data migration | First, alone | Migrations, DB types, data move |
| 1b | Sub-board UI scrub + Epic UI removal | After 1a merges | UI labels, type picker, old `components/epic/*` deletion |
| 2 | Security baseline | After 1a starts; parallel with 3a/3b/3c | Middleware, RLS, allowlist, email labels |
| 3a | DB indexes | Parallel after 1a | Additive index migrations |
| 3b | Pool config audit | Parallel after 1a | Supabase client config |
| 3c | Batch update refactor | Parallel after 1a | Bulk archive + sprint date shift |
| 4 | Shared workspace data + cache | After 1a; blocks 6/7/8 | Layout fetch, shared cache, view consumers |
| 5 | Cross-tab auth | After 2 lands middleware | BroadcastChannel, storage events |
| 6a | Card type lock + due-date dedup | After 1b, parallel with 6b/6c | Type picker edit lock, new-card-dialog |
| 6b | Defaults (lists + subtask owner) | After 1a, parallel with 6a/6c | board template, subtask creation |
| 6c | Backlog list movement | Parallel with 6a/6b | bulk-action-bar, lists actions |
| 7 | Card modal/history | After 4 | T1.1 click, type highlight, subtask list, lazy history |
| 8 | Roadmap fixes | After 4 | Return-to-Roadmap, lane 404, rank collision, badges |
| 9a | Board virtualization | After 4, Phase 2.5 | Flag-gated; before 6/7/8 touch same files OR explicit rebase |
| 9b | User preferences persistence | After 4 | Provider, debounced write-back, migration |
| 9c | Date component behavior | Parallel with 9b | UI-only |
| 10 | Cleanup/clarified items | Last | Labels, shortcut, errors, seed reports, guest perms (post D0.3) |

> Note: 9a (virtualization) is sequenced into Phase 2.5 in the phase plan; if its writeset overlaps a running 6/7/8, virtualization runs first.

### Suggested concurrency timeline

1. **Wave 1:** 1a alone.
2. **Wave 2:** 1b (after 1a merges) + 2 + 3a + 3b — 4 parallel.
3. **Wave 3:** 3c + 4 — 2 parallel (3c may also run in wave 2 if `actions/cards.ts` writeset disjoint from 1b).
4. **Wave 4:** 9a (virtualization) alone or with 5 if file ownership clearly disjoint.
5. **Wave 5:** 6a + 6b + 6c + 7 — 4 parallel.
6. **Wave 6:** 8 + 9b + 9c — 3 parallel.
7. **Wave 7:** 10 alone.

**Why not 20 agents?** Splitting 7 into {T1.1 click, type highlight, subtask list, lazy history} risks inconsistent card-modal state; splitting 4 risks two writers on `app/(app)/layout.tsx`; splitting 1b loses cohesion of Epic-language removal. The bottleneck is dispatch 4, not agent count.

---

## How to Dispatch and Monitor Codex Agents

This section describes the **operational mechanics** of running the 15 dispatches. The orchestrator (Claude in the parent session) does not write code for these dispatches — it dispatches Codex agents and verifies their output.

### Dispatch mechanism

Codex agents are invoked through the **`codex:codex-rescue` subagent**, which forwards a single `task` call to the local Codex helper. The orchestrator does **not** call the Codex CLI directly.

**Invocation pattern (orchestrator side):**

```
Agent({
  description: "<3-5 word task summary>",
  subagent_type: "codex:codex-rescue",
  prompt: "<full self-contained dispatch prompt — see Dispatch Prompt Template below>"
})
```

- One `Agent` call per dispatch. Do not bundle multiple dispatches into one prompt.
- For parallel waves, send a **single message** with multiple `Agent` tool-use blocks in it. That guarantees concurrent execution.
- Default behavior is write-capable Codex. The agent will edit files and commit.
- Use `run_in_background: true` only when the dispatch is long-running and you have other independent work. Otherwise foreground so you receive the completion report directly.

### Dispatch prompt template

Every dispatch prompt must include:

```text
You are Codex, running as dispatch <N> ("<Agent name>") from
docs/superpowers/specs/2026-05-14-sheet1-claude-execution-plan.md.

## Scope
<Copy the Ownership cell from the File Ownership Matrix verbatim.>
You may WRITE only files matching the paths above. You may READ everything else.
Touching a file outside your writeset is a hard violation — stop and report instead.

## Phase 0 decisions you must follow
- D0.1 mapping rule: <value or "default 1:1 lift">
- D0.2 grep allowlist: see spec.
- <Other decisions only if they bind this dispatch.>

## Feature flags this dispatch must respect
<Copy applicable flag rows from the Feature Flags table, or "none".>

## Performance targets you must measure
<Copy applicable rows from the Performance Targets table, or "none".>

## Deliverables
1. Code changes confined to your writeset.
2. Migrations: additive + reversible. Include the `down`.
3. Tests:
   - ≥1 for workflow/UI dispatch, ≥3 for architecture dispatch (golden, migration/back-compat, failure/edge).
4. The Completion Report block from the spec, filled in.
5. Measured performance numbers vs. targets, or an explicit "could not measure because X".

## Hard rules
- No commits outside the writeset.
- No changes to files owned by another in-flight dispatch.
- No skipped tests, no `--no-verify`.
- If you discover a Phase 0 ambiguity, stop and write the question instead of guessing.

Return the Completion Report as the final output.
```

The orchestrator fills the bracketed `<...>` placeholders from the matrix and target tables before each call.

### Wave gate (between waves)

Do **not** start the next wave until every dispatch in the current wave has:

1. Returned a Completion Report containing the required test cases.
2. Reported measured perf vs. targets (or explicit "could not measure" reason).
3. Had its changes verified by the orchestrator running, locally:
   - `npm run typecheck`
   - `npm run lint`
   - `npm run test -- <changed-area>` (or full `npm test` after wave 2 and 4)
   - For migration dispatches: `supabase db reset` against a scratch DB, then re-run.
4. Had its writeset confirmed disjoint from the next wave's writeset (re-check the matrix).

If any check fails: re-dispatch the same agent with the failure attached, using `--resume` so it continues with full context (`codex:codex-rescue` will translate `--resume` to `task --resume-last`).

### Monitoring during a wave

While dispatches run:

- **Foreground dispatches:** the orchestrator receives the Completion Report as the `Agent` tool result. No polling.
- **Background dispatches (`run_in_background: true`):** the orchestrator is notified on completion. Do not poll. Use the Monitor tool only when a dispatch is genuinely streaming and you need to react to specific events — not as a heartbeat.
- **Stuck dispatch (no progress signal, > 20 min on a small dispatch / > 60 min on an arch dispatch):** cancel and re-dispatch with a tightened scope; do not let it grind.
- **Conflicting writeset detected mid-wave** (two dispatches edited the same file): the later-finishing dispatch must rebase onto the earlier one's commit and re-run its tests. Do not auto-merge.

### Failure / escalation policy

| Symptom | Action |
|---|---|
| Tests fail in completion report | Re-dispatch same agent with `--resume` and the failing test names in the prompt. |
| Agent edited outside writeset | Hard-reject. Revert the offending commits. Re-dispatch with the writeset re-stated and the violation cited. |
| Agent skipped tests / used `--no-verify` | Hard-reject. Same as above. |
| Performance target missed | If the regression is acceptable, document and lower the target with reasoning. Otherwise re-dispatch as a perf-focused follow-up. |
| Agent discovered Phase 0 ambiguity | Stop the dispatch. Resolve the decision (update this doc). Re-dispatch with the resolved value. |
| Schema conflict between two migrations from the same wave | Squash into a single migration filename owned by dispatch 1a or 3a, whichever applies. |
| Codex run errors / helper fails | Re-invoke once. If it fails twice, switch to a Claude-direct implementation for that single dispatch and note the deviation. |

### Coordination artifacts

The orchestrator maintains, in the working tree under `tasks/dispatch-log/`:

- `wave-<N>.md`: which dispatches ran, when they started, when they returned, their commit SHAs, and their reports.
- `writeset-<dispatch>.txt`: the actual files touched (from `git diff --name-only`), to verify against the matrix.
- `perf-<dispatch>.md`: measured numbers vs. target.

These exist so the next session — or another reviewer — can resume mid-plan without re-reading every commit.

### What the orchestrator does NOT do

- Does **not** edit code itself during a dispatch. (Exception: when forced to bypass a failed Codex run; flagged in the log.)
- Does **not** inspect the repo on Codex's behalf — the dispatch prompt is self-contained.
- Does **not** poll, summarize, or paraphrase Codex output mid-run. The Completion Report is the source of truth.
- Does **not** start a parallel dispatch whose writeset overlaps a running one, even if "it's probably fine".

### Sample first-wave dispatch (concrete)

```
Agent({
  description: "Dispatch 1a sub-board model",
  subagent_type: "codex:codex-rescue",
  prompt: """
You are Codex, running as dispatch 1a ("Sub-board data model + Epic data migration")
from docs/superpowers/specs/2026-05-14-sheet1-claude-execution-plan.md.

## Scope
Owns (write): supabase/migrations/0099_*..010X_*.sql, lib/db/types.ts,
lib/epic/* (delete or rename to lib/subboard/*),
actions/cards.ts (only the paths handling type='epic').
Reads (no write): rest of lib/, actions/boards.ts.

## Phase 0 decisions
- D0.1 mapping rule: 1:1 lift. Each existing card with type='epic' becomes one
  sub-board (board with parent_board_id). Children re-parent to the sub-board.
  Migration sets _migrated_from_epic_id on the new sub-board row.
- D0.7 rollout: sub-board UI is gated by workspace flag subboards_enabled,
  but the data migration runs unconditionally.

## Feature flag
subboards_enabled — workspace-level, default off in prod.

## Deliverables
1. Migrations creating boards.parent_board_id + reversible Epic→sub-board move.
2. Generated DB types updated (lib/db/types.ts).
3. lib/epic/* removed or renamed; no runtime usage of Epic concept.
4. Three test cases:
   a. Golden: create a sub-board, list under parent.
   b. Migration/back-compat: existing Epic rows become sub-boards; counts match;
      children reparent correctly.
   c. Failure/edge: rolling back the migration restores Epic rows.
5. Completion Report.

## Hard rules
- No commits outside the writeset.
- No skipped tests, no --no-verify.
- Stop and report if any Phase 0 ambiguity surfaces.
"""
})
```

Subsequent dispatches follow the same template, swapping scope/decisions/flags/deliverables from the matrix.

---

## How to Kick Off Execution in a New Chat

Paste **one** of the prompts below into a fresh Claude Code session inside the
`trello-foundation` repo. The prompt tells Claude that this doc is the source of
truth and puts it into orchestrator mode for the 15 Codex dispatches.

### Option A — Full kickoff (start from Wave 1)

Use when starting execution for the first time.

```text
Act as the orchestrator for the Sheet1 execution plan in
docs/superpowers/specs/2026-05-14-sheet1-claude-execution-plan.md.

Read that doc end to end before doing anything. Then:

1. Confirm Phase 0 decisions D0.1–D0.7. For any decision still marked
   "default if undecided", use the stated default and note it in
   tasks/dispatch-log/phase0-decisions.md.
2. Verify the working tree is clean (or stash) and we are on a feature branch
   off `main`. If not, ask me before continuing.
3. Create tasks/dispatch-log/ if it does not exist.
4. Start Wave 1: dispatch 1a only, via the codex:codex-rescue subagent, using
   the prompt template from the "How to Dispatch and Monitor Codex Agents"
   section of the spec.
5. On return: run the Wave Gate checks (typecheck, lint, targeted tests,
   writeset disjoint vs Wave 2). Write the wave log and writeset file.
6. Then proceed to Wave 2 (1b + 2 + 3a + 3b in parallel), then Wave 3, etc.,
   stopping at every wave gate.

Rules:
- You do NOT edit code yourself. Codex agents do.
- Never start a parallel dispatch whose writeset overlaps a running one.
- After each wave, summarize results to me before starting the next wave.
- Stop and ask me if any Phase 0 ambiguity surfaces during a dispatch.
- Use the Performance Targets table for measurement; require Codex to report
  measured numbers or an explicit "could not measure because X".

Begin by reading the spec and reporting Phase 0 status. Do not dispatch
anything until I confirm.
```

### Option B — Resume kickoff (continuing from a specific wave)

Use when picking up an in-progress execution in a new session.

```text
Resume the Sheet1 execution plan in
docs/superpowers/specs/2026-05-14-sheet1-claude-execution-plan.md.

Read that spec end to end. Then read tasks/dispatch-log/ to learn what has
already shipped. Tell me:

1. Which dispatches are complete (with their commit SHAs).
2. Which dispatch is in-flight, if any.
3. Which wave we are about to enter.
4. Any open questions (Phase 0 ambiguities, perf misses, writeset collisions)
   from prior waves.

Wait for my confirmation before dispatching anything. Then continue from the
next wave per the spec's concurrency timeline.

Same rules as the full kickoff: you orchestrate, Codex implements, wave gates
are mandatory, no parallel dispatches with overlapping writesets.
```

### Option C — Single-dispatch kickoff (test the loop on one agent)

Use the first time you run this, to verify the dispatch + wave-gate loop works
before turning loose four parallel agents.

```text
Run only dispatch 1a from
docs/superpowers/specs/2026-05-14-sheet1-claude-execution-plan.md.

Steps:
1. Read the spec, the Phase 0 decisions, and the File Ownership Matrix row for 1a.
2. Build the dispatch prompt using the template in "How to Dispatch and Monitor
   Codex Agents" → "Sample first-wave dispatch".
3. Invoke codex:codex-rescue with that prompt (foreground, not background).
4. When it returns, run the Wave Gate checks: typecheck, lint, migration reset,
   targeted tests.
5. Write tasks/dispatch-log/wave-1.md and tasks/dispatch-log/writeset-1a.txt.
6. Report results to me and STOP. Do not start Wave 2.

You do not edit code. Codex does. If anything is ambiguous, stop and ask.
```

### What you (the human) verify after I report back

- The completion report has the right number of test cases (≥3 for 1a/1b/2/4/5/9a, ≥1 otherwise).
- Perf numbers were measured, or "could not measure" reason is stated.
- `git diff --name-only HEAD~..HEAD` is a subset of the dispatch's declared writeset.
- All wave-gate checks passed locally.
- The wave log file exists and is accurate.

If any of those is missing, tell me to re-dispatch with `--resume` and the specific gap.

### Common mis-prompts to avoid

- "Start working on the doc." — too vague; I won't know whether to plan, dispatch, or implement myself.
- "Implement the plan." — risks me writing code directly instead of dispatching to Codex.
- "Run all 15 dispatches." — violates wave gates and parallelism cap.
- "Just do wave 2." — skips Wave 1, breaks the dependency chain. Use Option B to resume properly.

Use Option A / B / C above instead.

---

## Required Completion Report Prompt

At the end of **each task or agent dispatch**, require Claude/Codex to send this report:

```text
Task completion report:

1. What was done:
   - Summarize the implemented behavior in 3-6 bullets.

2. Expected result and improvement:
   - State the expected user/system result.
   - State the improvement compared with the previous behavior.

3. Test cases:
   - Give at least ONE concrete test case for workflow/UI dispatches.
   - Give at least THREE concrete test cases for architecture dispatches (1a, 1b, 2, 4, 5, 9a) covering: golden path, migration/back-compat path, failure/edge path.
   - Each test case: setup, action, expected result, actual result.
   - Include the exact command(s) run when applicable.
   - Include the measured value vs. the target from the Performance Targets table when applicable.

4. Files changed:
   - List the main files and migrations changed.

5. Risks / follow-ups:
   - List any remaining risks, skipped tests, or decisions still needed.
```

No task should be considered complete without this completion report and the required number of concrete test cases (≥1 workflow/UI, ≥3 architecture). Any performance-target dispatch must include measured numbers or an explicit "could not measure because X" statement.

---

## Suggested Claude Subprompts

### Sub-Board + Epic-Removal Agent

```text
Implement the Sheet1 sub-board foundation and remove the old Epic concept. A sub-board is a board with a parent board. Search the repository for epic/Epic/EPIC/type='epic' and remove or migrate all product-facing behavior: UI labels, task type options, old creation/edit flows, seed concepts, route concepts, helpers, docs, and tests. Implement the new sub-board data model, parent-board selector, default-list behavior, navigation, and success feedback. Existing Epic data should be migrated or mapped into sub-boards so users do not see Epic as a concept anymore. Return the required completion report with at least one test case proving a user can create/open a sub-board and cannot create/select an Epic.
```

### Security Agent

```text
Implement the Sheet1 security baseline only. Inspect existing Supabase migrations and auth middleware. Enable or replace disabled auth-domain allowlist and storage RLS migrations if appropriate, add/verify a middleware gate for unauthenticated access to protected dashboard/internal API routes, and centralize notification email kind labels. Do not touch Board/Roadmap UI. Return the required completion report with changed files, tests, one concrete auth/security test case, and any manual Supabase dashboard steps.
```

### DB Performance Agent

```text
Implement only the database performance quick wins. Check existing migrations first, then add missing indexes for unread notifications, card field history by card/date, and activity by board/date. Inspect bulk archive and sprint date shifting code; if small and isolated, replace row-by-row updates with batch updates. If the code path is broad, report the exact files and proposed patch before editing. Return the required completion report with migration names, one concrete performance test case, and before/after query or latency evidence where possible.
```

### Shared Workspace Data Agent

```text
Refactor workspace Board/Roadmap data loading only. Move shared workspace data fetching to the workspace layout or parent server component, hydrate a shared client cache, and update BoardView/RoadmapView to consume that shared data. Keep tab switches client-side so Board and Roadmap do not remount or refetch unnecessarily. Do not mix in unrelated UI bug fixes. Acceptance: switching Board/Roadmap is instant, no spinner flicker, mutations update shared state. Return the required completion report with one test case that switches views and verifies no stale data.
```

### Cross-Tab Auth Agent

```text
Implement one unified cross-tab auth/session sync system. Use Supabase localStorage persistence, storage events, and a single BroadcastChannel naming strategy. Prevent token refresh loops and make logout/login update other tabs quickly. If tabId tracking is required, use sessionStorage and keep it separate from shared session state. Do not implement Board virtualization in this same change. Return the required completion report with one multi-tab login/logout test case.
```

### Board/Card Bug Agent

```text
Implement only the selected Board/Card workflow bugs from Sheet1 after sub-board/Epic-removal foundation lands. Do not create or preserve Epic-facing product behavior. Lock card type in edit mode, remove duplicated due date from creation, default new board/sub-board lists, default subtask owner from parent owner, and fix backlog list movement. Keep changes small and add targeted regression tests or clear manual verification steps. Return the required completion report with one concrete workflow test case.
```

### Roadmap Bug Agent

```text
Implement only Roadmap-specific fixes. Fix lane-name 404 navigation, rank collision during lane ordering, and return-to-Roadmap behavior after opening task details from Roadmap. Coordinate with shared workspace cache if it exists; do not introduce a separate data-loading path. Return the required completion report with one Roadmap test case.
```

---

## Items Already Closed or Empty

- The Vercel issue about the old board-selection flow is marked **Closed** in the sheet. Treat it as obsolete after Epic removal unless a data migration test exposes a regression.
- The final Low/Develop row is empty and should be ignored.
