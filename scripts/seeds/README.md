# Seeding — How to Not Break Things

Every seed script in this repo lives under `scripts/seeds/`. Run them through `./scripts/seeds/run.sh` — it handles env discovery, sensitive-key prompts, and safety guards.

---

## TL;DR

```bash
# Local Supabase
./scripts/seeds/run.sh local aiwepi
./scripts/seeds/run.sh local testbed-500-cards

# Prod Supabase (interactive — paste service-role key when prompted)
./scripts/seeds/run.sh prod aiwepi

# Prod + wipe existing AIWEPI workspace before re-seeding
./scripts/seeds/run.sh prod aiwepi --reset

# Override owner email (default for aiwepi: team@innovina.it)
SEED_EMAIL=alice@innovina.it ./scripts/seeds/run.sh prod aiwepi

# Override the synthetic "current month" anchor (1..24, default 5)
SEED_CURRENT_MONTH=10 ./scripts/seeds/run.sh prod aiwepi --reset
```

Bare names (`aiwepi`, `testbed-500-cards`, …) resolve to `scripts/seeds/<name>.mjs`. Full paths also work.

---

## Available seed scripts

| Name | What it seeds | Default owner | Uses new-format features |
|---|---|---|---|
| `aiwepi` | AIWEPI Switch project plan — sub-boards, milestones, status-mixed cards | `team@innovina.it` | sub-boards (parent_board_id), `workspaces.feature_flags`, `milestones` table, status_kind on INSERT |
| `swich-mars` | Swich / M.A.R.S. Firefighter plan — 5 OR sub-boards, 25 WP tasks, 22 deliverable subtasks (+ Google Doc per deliverable), 8 milestones (16 Jan 2026 → 16 Jul 2028) | `team@innovina.it` | sub-boards (parent_board_id + parent_card_id), `workspaces.feature_flags`, `milestones` table w/ description, calendar-month dating |
| `testbed-500-cards` | Board "TB-Big" with 500 cards in Backlog | `testbed@local` | `feature_flags.virtualized_board=true` |
| `testbed-100-sprint` | "TB-Sprint" board + "TB-Sprint-100" sprint w/ 100 cards | `testbed@local` | bulk-archive / sprint-shift fixtures |
| `testbed-5k-notif` | 5000 unread notifications for testbed user | `testbed@local` | partial index fixture (mig 0101) |
| `testbed-member` | `testbed-member@local` + `testbed-outsider@local` | n/a | guest surrogate + storage-RLS test fixture |

`testbed-common.mjs` is shared infrastructure (not runnable).

---

## The five traps

### 1. Auth allowlist rejects fake-domain emails (migration 0056)

> `Signup is restricted to internal addresses (foo.com not allowed).`

`auth_block_external_domains` is wired in **both local and prod**. Allowed: `innovina.it`. Affects scripts that create users via `admin.auth.admin.createUser({email})`. Use an `@innovina.it` email or run against an EXISTING user (every seed in this folder works against existing users).

### 2. Migration 0100 rejects direct subtask children of epic cards

> `epic-to-subboard migration blocked: N direct epic child cards are type=subtask`

Fires during `supabase db push` against a DB with historical `Epic → Subtask` data. Sheet1's design says deliverables (subtasks) hang off stories, not epics.

Cheapest fix (keeps everything else):
```sql
delete from public.cards
 where parent_card_id in (select id from public.cards where type='epic')
   and type = 'subtask'
returning id, title;
```
Then re-run `supabase db push`. Background: `tasks/dispatch-log/hotfixes.md`.

### 3. `vercel env pull` returns empty values for Sensitive vars

Vercel marks Supabase secrets as **Sensitive**. The CLI no longer decrypts them to disk → you get `KEY=""`.

`run.sh` detects empty values from the pull and prompts for the service-role key via `read -rs` (hidden, no shell history). Get it from Supabase Studio:
`https://supabase.com/dashboard/project/xndddfopnlrzkydtnjxo/settings/api`

### 4. RTK shell wrapper shadows env vars

The `rtk` (Rust Token Killer) tool hooks every command and pre-loads `.env.local` via its own dotenv injector. This OVERRIDES `export` / `set -a; source ...`. Seed scripts therefore read whatever's in `.env.local`, not what you set.

Every seed in this folder honors `SEED_ENV_FILE`. The script parses that file directly with `readFileSync` — bypasses both dotenv and rtk. `run.sh` writes the temp file and passes the path. Don't try `set -a; source /tmp/prod.env; node ...` — rtk wins.

### 5. Trigger blocks owner_id changes by service-role JWT (migration 0081)

> `UPDATE cards: Only authenticated users can change owner.`

`enforce_card_owner_change_policy` requires the request's JWT to have `aud='authenticated'`. Service-role keys have `aud='service_role'`.

**Rule**: set `owner_id` at INSERT, never via UPDATE. Trigger fires only on owner_id CHANGE. All current seeds follow this.

---

## How seed scripts find their env

```js
if (process.env.SEED_ENV_FILE) {
  // Parse the file ourselves (bypass dotenv + rtk).
  const text = readFileSync(process.env.SEED_ENV_FILE, "utf8");
  for (const line of text.split(/\r?\n/)) { /* set process.env[K] = V */ }
} else {
  // Fall through to .env.local for the default local-dev path.
  config({ path: "../../.env.local" });
}
```

Use `SEED_ENV_FILE` for prod (or for any one-off env file). Use the default for local.

---

## `aiwepi` — what it builds

The new AIWEPI seed reflects Sheet1's "new DB format":

```
Workspace "AIWEPI Switch"  (feature_flags: subboards_enabled + shared_workspace_cache_v2)
├── Parent board "AIWEPI Project Plan"
│   ├── Lists: Todo / In Progress / Done (no cards)
│   └── 5 Milestones (M1.1..M1.5) pinned to the parent board
└── 5 sub-boards (parent_board_id = parent board)
    └── WPx.y sub-board (each)
        ├── Lists: Todo / In Progress / Done
        ├── "WPx.y Overview" card  (story, dates = full WP range)  ← roadmap lane anchor
        ├── Tx.y task cards         (story, parent = overview, dates = sliced segment of the WP range)
        └── Dx.y.z deliverable cards (subtask, parent = related task)
```

**Status mixing**: cards land in Todo / In Progress / Done based on `SEED_CURRENT_MONTH` (default 5). Cards whose end month ≤ current month are Done (with `completed_at` set); cards whose start month ≤ current month < end month are In Progress; rest are Todo.

**Date slicing**: tasks within a WP get consecutive segments of the WP's date range rather than the full range, so the roadmap shows distinct task bars under each WP lane rather than overlapping bars.

**Owner**: every card has `owner_id` set on INSERT (avoiding the 0081 trigger). Default user is `team@innovina.it`.

Override anything via env: `SEED_EMAIL`, `SEED_WORKSPACE`, `SEED_CURRENT_MONTH`.

---

## `swich-mars` — what it builds

Distinct project from `aiwepi`. Source: "Swich — WP e Piano di Progetto" (firefighting-UAV programme, M.A.R.S. Firefighter). Same machinery as `aiwepi`, different content.

```
Workspace "Swich — M.A.R.S. Firefighter"  (feature_flags: subboards_enabled + shared_workspace_cache_v2)
├── Parent board "Swich · Piano di Progetto"
│   ├── Lists: Todo / In Progress / Done
│   ├── 5 OR anchor cards (task, dates = full OR range)   ← one per Obiettivo Realizzativo
│   └── 8 Milestones (M1.1, M1.2, M2.1, M2.2, M3.1, M3.2, M4.1, M5.1) pinned to the parent board, with descriptions
└── 5 sub-boards (parent_board_id = parent, parent_card_id = OR anchor)
    └── ORn sub-board (each)
        ├── Lists: Todo / In Progress / Done
        ├── WPx.y task cards       (task, dates = WP text range; desc leads with RI/SS · partner · months · consulting)
        └── Dx.y.z deliverable cards (subtask, parent = most-related WP, dated at their reporting milestone)
            └── + a yellow URL link (card-scope `links` row). When GOOGLE_SA_KEYFILE is set,
                the link points at a real Google Doc the seed creates/reuses in the Drive
                folder; otherwise it falls back to a placeholder URL.
```

### Google Drive docs per deliverable (optional)

When `GOOGLE_SA_KEYFILE` points at a service-account JSON key, the seed creates (or reuses)
one empty Google Doc per deliverable and links each deliverable card to that doc's
`webViewLink`. Drive layout:

```
<SWICH_DRIVE_FOLDER_ID>/
├── OR1 — …/   └── Deliverables/   ├── D1.1.1 — …   ├── D1.1.2 — …   …
├── OR2 — …/   └── Deliverables/   └── D2.1.1 — …
└── …                              (one OR folder each, all find-or-created)
```

- **Service account** must be a member of the (Shared Drive) folder with create rights. A
  Shared Drive is required in practice — a service account has no storage quota, so creating
  in a personal *My Drive* folder fails with `storageQuotaExceeded`.
- **Idempotent**: find-or-create by name (folders cached per run). The SA can create but not
  delete in the Shared Drive, so re-seeding reuses the same folders/docs (stable URLs) rather
  than duplicating them.
- Docs are named after the deliverable title (e.g. `D1.1.1 — Report Requisiti tecnici …`),
  nested under a folder per OR and a `Deliverables` folder inside each OR.
- Env: `GOOGLE_SA_KEYFILE` (path to SA JSON), `SWICH_DRIVE_FOLDER_ID` (default
  `1iysVHSw6qtnpsCNLswV-mB_sq9hS3eZK`), `SWICH_DELIVERABLE_SUBFOLDER` (default `Deliverables`).
- `scripts/seeds/seed-swich-prod.sh` auto-passes `GOOGLE_SA_KEYFILE=/tmp/sa.json` when that
  file exists. Requires `googleapis` (devDependency).

- **Span**: calendar months, M1 = 16 Jan 2026 → 16 Jul 2028 (30 months). A WP "Mx–My" spans `monthStart(x)`→`monthStart(y+1)`.
- **Counts**: 5 OR · 25 WP · 22 deliverables (each with a yellow link → its Google Doc, or a placeholder) · 8 milestones.
- **Deliverable parenting**: deliverables map to milestones in the source, not 1:1 to WPs, so each is parented to the most topically-related WP and dated at its milestone (the producing WP may finish earlier — faithful to R&D reporting gates).
- **All cards land in Todo, `owner_id = null`** (unowned template: "Mine" empty, team self-assigns). SEED_EMAIL is workspace owner + board admin.
- **OR5 date note**: the OR table gives OR5 as M24–M30 but its WPs state M16–M30; the anchor uses M24–M30 and WPs use M16–M30 — the source is internally inconsistent and we encode it faithfully.

Override via env: `SEED_EMAIL`, `SEED_WORKSPACE`, `SEED_RESET`, `GOOGLE_SA_KEYFILE`, `SWICH_DRIVE_FOLDER_ID`, `SWICH_DELIVERABLE_SUBFOLDER`.

---

## Idempotency + reset

`aiwepi` is idempotent — if the workspace exists for the owner, it exits cleanly. To wipe and re-seed:

```bash
./scripts/seeds/run.sh prod aiwepi --reset
```

`--reset` issues `delete from workspaces where id = ...`; FK CASCADE handles boards / cards / lists / milestones / members.

The `testbed-*` seeds use check-then-insert per row — re-running is safe but won't overwrite changed data.

---

## Run-against-prod safety guards in run.sh

- `target=prod` + URL pointing at `127.0.0.1` → refuses.
- `target=local` + URL not localhost / 192.168.* → refuses.
- Temp env file is `mode 600` and `shred -u`'d on exit (including Ctrl-C).
- Service-role prompt uses `read -rs` (no terminal echo, no shell history).
- Bare seed names auto-resolve to `scripts/seeds/<name>.mjs`.
- Refuses to run `testbed-common.mjs` directly (shared lib).

If you bypass `run.sh` and call a script directly with `SEED_ENV_FILE=…`, you lose these guards. Don't.

---

## Adding a new seed

1. Place at `scripts/seeds/<name>.mjs`.
2. Copy the `SEED_ENV_FILE`-aware preamble from `aiwepi.mjs` (lines 1–80).
3. Resolve owner via `findUser(SEED_EMAIL)` — never call `auth.admin.createUser` unless the email matches `@innovina.it`.
4. Set `owner_id` on INSERT, not via UPDATE.
5. Add a row to the seed table in this README.
6. Run via `./scripts/seeds/run.sh <local|prod> <name>`.

---

## Common operations

### Wipe local DB + restore everything from scratch

```bash
npm run db:reset
./scripts/seeds/run.sh local testbed-member
./scripts/seeds/run.sh local testbed-500-cards
./scripts/seeds/run.sh local testbed-100-sprint
./scripts/seeds/run.sh local testbed-5k-notif
# aiwepi locally needs an @innovina.it user — create one first or use SEED_EMAIL=testbed@local
SEED_EMAIL=testbed@local ./scripts/seeds/run.sh local aiwepi
```

### Re-seed AIWEPI in prod with a different "today" anchor

```bash
SEED_CURRENT_MONTH=10 ./scripts/seeds/run.sh prod aiwepi --reset
```

### Remove an AIWEPI workspace from prod without re-seeding

```sql
-- Supabase Studio SQL editor
delete from public.workspaces where name = 'AIWEPI Switch' and owner_id = (
  select id from auth.users where email = 'team@innovina.it'
);
-- FK CASCADE drops boards / lists / cards / milestones / members.
```
