# Jira-Lite Roadmap

> **Scope:** Move the Trello-clone toward feature parity with Jira's most-loved capabilities across **Structure, Planning, Reports, Automation, Time, Notifications/Collab**. This is a meta-plan: it decomposes the bucket list into 18 atomic sub-plans (#8-#25), each shippable independently, with ordering + dependencies.
>
> The existing app already has: workspaces, boards, lists, cards, drag-drop, realtime, labels, members, due dates, comments, attachments, activity log, full-text search, presence, RLS, CI. Each sub-plan below extends the schema + RLS + Server Actions + UI in the same patterns established by plans #1-#7.
>
> **Estimated total scope:** ~250 tasks across 18 plans. Each plan ~10-25 tasks. Realistic delivery for a single engineer = several months. For a team of 3-4 = 6-10 weeks if executed in parallel.

---

## Sub-plan map

```
STRUCTURE                    PLANNING                    REPORTS
──────────                   ──────────                  ──────────
#8  Issue types + hierarchy  #11 Sprints + backlog       #16 Dashboards + gadgets
#9  Issue links              #12 Story points + velocity #17 CSV / Excel export
#10 Components/Versions      #13 Roadmap / Timeline
                             #14 WIP + swimlanes + filt
                             #15 JQL-lite + saved filt

AUTOMATION                   TIME                        COLLAB / NOTIF
──────────                   ────                        ──────────────
#18 Rules engine             #22 Estimate + worklog +    #23 @mentions + watchers
#19 Webhooks + REST API           SLA tracking                + email digest + inbox
#20 Email-to-issue ingest                                #24 Push notifications
#21 CI/CD link (GH/GL)                                   #25 Mobile app (Expo PWA)
```

---

## Cross-cutting prep — ALL plans assume

- Every new table follows the existing pattern: denormalized `board_id` (or `workspace_id`) for RLS + realtime publication add.
- Server Actions split impl/wrapper. Integration tests for happy + RLS denial.
- Add to `lib/queries/board-snapshot.ts` if it should ride realtime.
- Validation in `lib/validation.ts`. Drizzle mirror in `lib/db/schema.ts`.
- After each migration: `supabase db reset && docker restart supabase_kong_trello-foundation && sleep 2`.

---

## Plan #8 — Issue types + hierarchy

**Goal:** Cards become typed (epic / story / task / sub-task / bug). Sub-tasks belong to a parent card. Epics aggregate stories.

**Migrations:**
- `0018_card_types.sql` — `cards.type text not null default 'task'` (CHECK: epic|story|task|subtask|bug), `cards.parent_card_id uuid` self-FK ON DELETE SET NULL, index `(parent_card_id)`.
- Trigger guard: subtask must have parent of type story|task. Cycle detection.
- Optional `card_codes` view for `#WS-N` short numeric IDs per workspace (counter on workspaces).

**UI:**
- Type picker chip on card modal (5 icons + text).
- Parent picker (search + select) → shows on card modal as breadcrumb.
- "Sub-tasks" section in modal → list of children with inline create / progress bar.
- Tile shows type icon + parent code stamp `#WS-12 ⤴`.
- Board view filter: hide-subtasks toggle (default on).

**Tests:** type CHECK enforced, sub-task lookup, parent breadcrumb on snapshot.

**Tasks:** ~15. **Depends on:** plan #5 (cards modal sections).

---

## Plan #9 — Issue links (blocks, relates, duplicates)

**Goal:** Two cards can be linked with semantic kind: `blocks`, `is_blocked_by` (inverse), `relates_to`, `duplicates`, `is_duplicated_by`.

**Migrations:**
- `0019_card_links.sql` — `card_links (id, from_card_id, to_card_id, kind text, board_id denorm, created_at, created_by)`. Composite unique `(from_card_id, to_card_id, kind)`. Trigger: when inserting `blocks`, also insert mirror `is_blocked_by`. Same for duplicates.
- RLS read = board members of from-card OR to-card.

**UI:**
- "Linked issues" section in card modal: list with kind icon + target title + click-to-navigate.
- "+ Link" button → search-card dialog → kind dropdown.
- Visual blocker badge on tile if `is_blocked_by` count > 0.

**Tests:** mirror trigger emits inverse link, link cleanup on card delete.

**Tasks:** ~12. **Depends on:** plan #5 (card modal).

---

## Plan #10 — Components, Versions, Releases

**Goal:** Workspace-level components (sub-areas of a project) and versions (release marker). Cards can be tagged with multiple components and assigned a fix-version.

**Migrations:**
- `0020_components.sql` — `components (id, board_id, name, lead_user_id?)` + `card_components (card_id, component_id, board_id denorm)` junction.
- `0021_versions.sql` — `versions (id, workspace_id, name, semver?, status enum(unreleased|released|archived), release_date)`. `card_versions (card_id, version_id, kind enum(affects|fixes), workspace_id denorm)`.

**UI:**
- Workspace settings → Components tab + Versions tab.
- Card modal → component multi-select + fix-version dropdown.
- New page `app/(app)/w/[wsId]/versions/[versionId]` showing all cards targeting that version with progress.
- Release notes auto-draft (cards w/ kind=fixes) — markdown export.

**Tasks:** ~16. **Depends on:** plan #2 (workspaces).

---

## Plan #11 — Sprints + backlog

**Goal:** Cards can live in a sprint or in the backlog. Sprint has goal, start/end dates, state.

**Migrations:**
- `0022_sprints.sql` — `sprints (id, workspace_id, name, goal, start_date, end_date, state enum(planned|active|completed))`. Workspaces can only have ONE active sprint at a time (partial unique index).
- `cards.sprint_id uuid` FK ON DELETE SET NULL. Cards w/o sprint_id = backlog.

**UI:**
- New page `app/(app)/w/[wsId]/backlog` — backlog grid + active sprint panel + planned sprints list.
- Drag cards from backlog into sprint.
- Sprint actions: start, complete (move incomplete cards back to backlog or next sprint).
- Board view gains sprint filter (active sprint only by default).

**Tests:** start-sprint enforces single-active rule, complete-sprint cleanup.

**Tasks:** ~18. **Depends on:** plan #2.

---

## Plan #12 — Story points + velocity + burndown

**Goal:** Cards have story-point estimates. Charts: per-sprint burndown, per-workspace velocity.

**Migrations:**
- `0023_estimates.sql` — `cards.story_points int` (nullable).
- `sprint_snapshots (id, sprint_id, captured_at, points_committed int, points_completed int, cards_remaining int)` — daily snapshot via `pg_cron` (or Vercel cron) for burndown.

**UI:**
- Card modal — story-point input (Fibonacci buttons: 1, 2, 3, 5, 8, 13, ?).
- Tile shows story-point chip top-right (replaces or sits next to card-id).
- Sprint page → burndown chart (recharts or chart.js, no extra deps if d3-shape already in tree; otherwise render SVG manually).
- Workspace page → velocity bar chart (last 6 sprints).

**Tasks:** ~14. **Depends on:** #11.

---

## Plan #13 — Roadmap / Timeline / Gantt

**Goal:** Date-based view of epics + stories. Horizontal bars on a calendar.

**Migrations:**
- `0024_card_dates.sql` — `cards.start_date timestamptz`, `cards.target_date timestamptz` (separate from due_date which is a deadline).

**UI:**
- New page `app/(app)/w/[wsId]/roadmap` — quarter / month / week view.
- Each row = epic; bars within = stories (auto-grouped by parent_card_id).
- Drag bar edges to resize, drag bar body to move dates.
- Dependency arrows from `blocks` links rendered between bars.

**Lib:** custom SVG renderer (no Gantt lib dep). ~400 LoC component.

**Tasks:** ~20. **Depends on:** #8, #9.

---

## Plan #14 — WIP limits, swimlanes, quick filters

**Goal:** Board view extensions for kanban discipline + slicing.

**Migrations:**
- `0025_list_wip.sql` — `lists.wip_limit int` (nullable).

**UI changes (board view):**
- List header shows `count / limit` chip; turns red when over.
- Optional swimlane mode: group by assignee | epic | component | label. Renders horizontal rows of lists.
- Quick filter bar: avatar chips for members + label pills + due-date toggle (`overdue`, `due-this-week`). Click toggles filter; URL query state for shareability.

**Tasks:** ~14. **Depends on:** #5 (labels/members).

---

## Plan #15 — JQL-lite + saved filters + cross-board search

**Goal:** Power-user search across all boards user can read.

**Migrations:**
- `0026_saved_filters.sql` — `saved_filters (id, owner_id, scope enum(personal|workspace), workspace_id?, name, query text)`.

**Lib:**
- `lib/jql/parser.ts` — small recursive-descent parser for `field:value AND/OR ...`. Fields: `assignee`, `label`, `status` (list name), `type`, `epic`, `component`, `version`, `text` (full-text), `due:overdue`, `created:>2025-01-01`.
- `lib/jql/translator.ts` — JQL AST → Drizzle SQL (param-bound).

**UI:**
- Search box upgrades: power-mode toggle. JQL textarea with autocomplete chips.
- Save query → saved filter. Saved-filters dropdown in nav.

**Tasks:** ~22. **Depends on:** #6 (search) + #8/#10/#11 (typed fields).

---

## Plan #16 — Dashboards + gadgets

**Goal:** Configurable dashboards with widgets (gadgets). Each user (and per workspace) can have multiple dashboards.

**Migrations:**
- `0027_dashboards.sql` — `dashboards (id, owner_id, scope enum(personal|workspace), workspace_id?, name)`.
- `0028_gadgets.sql` — `gadgets (id, dashboard_id, type text, config jsonb, position_x int, position_y int, width int, height int)`. Types: `count`, `bar-chart`, `pie-chart`, `velocity`, `burndown`, `cumulative-flow`, `recent-activity`, `assigned-to-me`, `due-this-week`, `markdown-note`.

**UI:**
- New page `app/(app)/dashboards` — list + create new.
- Dashboard editor: react-grid-layout (would be a new dep — alternative: simple CSS grid with drag-handles, custom).
- Gadget renderers per type. Reuse chart components from #12.

**Tasks:** ~28. **Depends on:** #11, #12, #14.

---

## Plan #17 — CSV / Excel export

**Goal:** Export cards to CSV (no dep) and XLSX (sheetjs / xlsx-populate).

**Files:**
- `app/api/export/board/[boardId]/route.ts` — streams CSV.
- `app/api/export/board/[boardId]/xlsx/route.ts` — streams XLSX.
- Field selection UI: which columns to include.

**Dep:** `xlsx-populate` or `exceljs` (~500KB).

**Tasks:** ~8. **Depends on:** none (works on existing schema).

---

## Plan #18 — Automation rules engine

**Goal:** "When X → do Y" rules per board. Trigger on activity events.

**Migrations:**
- `0029_rules.sql` — `rules (id, board_id, name, enabled bool, trigger jsonb, conditions jsonb, actions jsonb, created_by, created_at)`. `rule_runs (id, rule_id, status, triggered_at, payload jsonb, error?)`.
- New trigger fn `on_activity_insert_dispatch_rules()` AFTER INSERT on `activity` → calls `pg_notify('rule_dispatch', json)`.

**Service:**
- New Node listener `services/rules-worker.ts` (run via Vercel cron or separate Fly.io worker): subscribes to `pg_notify`, runs rule engine, writes `rule_runs` + executes actions.
- Action types: `set_field`, `add_label`, `add_member`, `move_to_list`, `transition_status`, `add_comment`, `notify_slack` (incoming webhook URL), `notify_email`, `webhook_post`.
- Trigger types: `card.created`, `card.moved`, `card.assigned`, `card.due_changed`, `comment.created`, `label.added`, etc.
- Conditions: any-of / all-of with field comparators.

**UI:**
- Board settings → Rules tab → list + editor (no-code: dropdown trigger → conditions builder → actions builder).
- Rule run log.

**Tasks:** ~30. **Depends on:** #6 (activity), realtime.

---

## Plan #19 — Webhooks + REST API + tokens

**Goal:** Programmatic access for integrators.

**Migrations:**
- `0030_api_tokens.sql` — `api_tokens (id, user_id, name, hashed_token, last_used_at, scopes text[], created_at, revoked_at?)`.
- `0031_webhooks.sql` — `webhooks (id, board_id, url, secret, event_filter text[], enabled, created_by)`. `webhook_deliveries (id, webhook_id, attempt, status, response_code, body, delivered_at)`.

**REST routes** under `app/api/v1/`:
- `GET /v1/workspaces`, `/v1/boards`, `/v1/boards/:id/cards`, etc.
- `POST /v1/boards/:id/cards` etc.
- Auth via `Authorization: Bearer trk_...` header → token lookup → user → dbAsUser-equivalent.

**Webhook delivery:** rule-engine action `webhook_post` + event subscription. HMAC-sign payloads with webhook secret. Retry with exponential backoff (max 5).

**UI:**
- User settings → API tokens (create / revoke / list).
- Board settings → Webhooks tab.

**Tasks:** ~25. **Depends on:** #18 (event source for webhooks).

---

## Plan #20 — Email-to-issue ingest

**Goal:** Send an email to `<board-id>@inbound.trinnovina.io` → creates a card in that board.

**Infra:** Supabase Edge Function `inbound-email` receives parsed payload from SendGrid Inbound Parse / Mailgun Routes / SES → SNS → Lambda → POST.

**Migrations:**
- `0032_inbound_addresses.sql` — `inbound_addresses (id, board_id, address, default_list_id, default_assignee_id?, created_at)`.
- `card_email_threads (card_id, message_id, in_reply_to)`.

**Logic:**
- Parse email subject → card title, body → description, attachments → registered.
- Reply emails (with `In-Reply-To` header) → comments on the original card.

**UI:** Board settings → Inbound Email → show mailbox address + copy button + default-list picker.

**Tasks:** ~16. **Depends on:** Supabase Edge Functions enabled. External service (SendGrid free tier).

---

## Plan #21 — CI/CD link

**Goal:** GitHub PRs / commits / deploy statuses appear on cards via card-id mention in commit message or PR title.

**Migrations:**
- `0033_card_codes.sql` — generate sequential card codes per workspace `<WS_KEY>-<N>` (e.g. `TR-127`); enable lookup. Move from cardCode hash helper to real numeric.
- `0034_github_integration.sql` — `gh_installations (id, workspace_id, installation_id int, account_login)`. `card_links_external (id, card_id, kind enum(github_pr|github_commit|github_run), url, status, ref, opened_at)`.

**Logic:**
- GitHub App that listens to repo webhooks. Parse messages for card codes. Create/update `card_links_external`.
- Ship a NextJS API route `/api/github/webhook` that verifies HMAC signature.

**UI:**
- Card modal → "Development" section: PRs (with status badge — open/closed/merged), commits, deploys.
- Tile gets a small Git icon when linked.

**Tasks:** ~22. **Depends on:** #19 (token infra).

---

## Plan #22 — Estimate + worklog + SLA

**Goal:** Time tracking and SLA breach alerts.

**Migrations:**
- `0035_time.sql` — `cards.estimate_min int`, `cards.spent_min int` (computed from worklogs via trigger). `worklogs (id, card_id, user_id, minutes int, started_at, comment, board_id denorm)`.
- `0036_sla.sql` — `sla_policies (id, board_id, name, target_min int, applies_when jsonb)`. `card_sla (card_id, sla_id, started_at, breached bool)`.

**Logic:**
- pg_cron job (or Vercel cron) every 5 min: scan card_sla rows whose `started_at + target_min < now()` and unresolved → mark breached, emit activity, optionally trigger rule.

**UI:**
- Card modal → Time tab: estimate input + log work form + worklog history.
- Board settings → SLAs tab.

**Tasks:** ~18.

---

## Plan #23 — @mentions + watchers + email digest + in-app inbox

**Goal:** Notify users of activity they care about.

**Migrations:**
- `0037_notifications.sql` — `notifications (id, recipient_user_id, kind, payload jsonb, related_card_id?, related_board_id?, read_at?, created_at)`.
- `0038_watchers.sql` — `card_watchers (card_id, user_id, board_id denorm, auto bool)`. Auto-add: card author + assignees + commenters.
- `0039_user_prefs.sql` — `user_notification_prefs (user_id, kind, channel enum(in_app|email|push), enabled)`.

**Logic:**
- @mention parser at comment write time: regex `@\w+` → look up users in board → insert notification.
- Trigger fns for events that should notify watchers: card moved, assigned, commented, completed.
- Daily digest: pg_cron / Vercel cron at 8am — assemble unread notifications per user, send via Resend API (free tier).
- In-app: bell icon in nav with unread count + dropdown panel, full inbox at `/inbox`.

**UI:**
- Mention autocomplete in comment composer.
- Bell + dropdown.
- `/inbox` page with filters (unread, mentions, comments, due).
- Settings → Notifications: per-channel/per-kind toggles.

**Tasks:** ~26.

---

## Plan #24 — Push notifications

**Goal:** Web Push (Service Worker + VAPID).

**Files:**
- `public/sw.js` — service worker registers push handler.
- `app/api/push/subscribe/route.ts` — store subscription.
- `0040_push_subscriptions.sql` — `push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at)`.

**Lib:** `web-push` npm pkg. Generate VAPID keys; store in env.

**Logic:** When notification of kind matching user pref `channel=push` is created → enqueue push send.

**UI:** Bell dropdown footer "Enable push notifications" button.

**Tasks:** ~10. **Depends on:** #23.

---

## Plan #25 — Mobile app (Expo)

**Goal:** iOS + Android via Expo. Read-only first version: list workspaces → boards → cards → modal. Drag-drop in a follow-up.

**Repo:** new `apps/mobile/` directory (monorepo) OR separate repo. Reuse `lib/queries/` + actions wrapped behind REST API (#19).

**Stack:** Expo Router, React Native Paper or Tamagui, supabase-js (works in RN), expo-notifications for push parity.

**Tasks:** ~30. **Depends on:** #19 (REST API), #24 (push).

---

## Recommended ordering

If resources are scarce, ship in this order — each unlocks next:

1. **#8 Issue types + hierarchy** (foundation for everything Jira-shaped)
2. **#9 Issue links** (small, high value)
3. **#11 Sprints + backlog** (immediate planning gain)
4. **#12 Story points + velocity** (reports follow naturally)
5. **#23 @mentions + watchers + inbox** (engagement multiplier)
6. **#14 WIP limits + swimlanes + filters** (power-user board)
7. **#22 Estimate + worklog** (time visibility)
8. **#18 Automation rules engine** (force multiplier)
9. **#19 Webhooks + REST API**
10. **#15 JQL-lite + saved filters**
11. **#10 Components + versions**
12. **#16 Dashboards**
13. **#13 Roadmap / Gantt**
14. **#17 CSV / Excel export**
15. **#24 Push notifications**
16. **#20 Email-to-issue**
17. **#21 CI/CD link**
18. **#25 Mobile app**

---

## What this roadmap deliberately omits (still missing vs Jira)

- Custom workflows (state machines per project) — would be plan #26
- Custom fields + per-type field schemes — plan #27
- Permission schemes (granular per-field, per-type) — plan #28
- Service desk + customer portal + SLA UI — plan #29
- Bulk edit UI — plan #30
- Issue templates — plan #31
- Marketplace / plugin sandbox — plan #32 (massive, may never need)
- SAML/SSO / SCIM provisioning — plan #33 (enterprise)

Pick from the list when ready. The foundation handles all of them with the same patterns.

---

## Pick & start

Tell me which plan to write first. Recommended start: **#8 Issue types + hierarchy** — it's the structural keystone that makes most other Jira features actually fit. ~15 tasks, ~1 day of subagent execution.
