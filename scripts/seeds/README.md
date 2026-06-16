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
| `aegis` | AEGIS olive-monitoring plan (azione111ds Liguria) — 5 WP sub-boards, 20 task cards, 7 deliverable subtasks (+ native Google Doc per deliverable, title-filled), 5 milestones (1 Jan 2026 → 30 Jun 2027) | `team@innovina.it` | same machinery as swich-mars; real calendar dates; prod ops: `seed-aegis-prod.sh` / `delete-aegis-prod.sh` (runtime name+owner resolution) |
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

> The mechanics below are shared by **all five Drive-enabled seeders** (`swich-mars`,
> `mars-wildfire`, `collabora-innova`, `arise-drive`, `aegis`).

When `GOOGLE_SA_KEYFILE` points at a service-account JSON key, the seed creates (or reuses)
one **native Google Doc** per deliverable — titled with the deliverable name and a
`lead · milestone` subtitle — and links each deliverable card to that doc's `webViewLink`.
Drive layout:

```
<SWICH_DRIVE_FOLDER_ID>/
├── OR1 — …/   └── Deliverables/   ├── D1.1.1 — …   ├── D1.1.2 — …   …
├── OR2 — …/   └── Deliverables/   └── D2.1.1 — …
└── …                              (one OR folder each, all find-or-created)
```

- **Service account** must be a member of the (Shared Drive) folder with create rights. A
  Shared Drive is required in practice — a service account has no storage quota, so creating
  in a personal *My Drive* folder fails with `storageQuotaExceeded`.
- **Native Doc, not raw .docx**: the doc is created with `requestBody.mimeType` = the native
  Google-Doc mime and the `.docx` template uploaded as `media`, so Drive *converts on upload*
  (no `.DOCX` badge, full native-Docs features). A doc uploaded with the `.docx` mime instead
  would stay a raw Office file — the bug this avoids.
- **Title/subtitle filled pre-upload**: the template ships with `[DOCUMENT TITLE]` /
  `[Document subtitle]` placeholders. Before upload the seeder patches a per-doc copy of the
  `.docx` (a zip) with python `zipfile` — the same surgery as `build-templates.py` — replacing
  the placeholders with the deliverable title and subtitle. **No Google Docs API** is used or
  needs enabling; everything is the Drive API plus local file editing.
- **Idempotent**: find-or-create by name, **filtered to the native-Doc mime** (so a leftover
  raw `.docx` from before the conversion fix is ignored, not reused). Folders cached per run.
  The SA can create but not delete in the Shared Drive, so re-seeding reuses the same
  folders/docs (stable URLs) rather than duplicating them.
- Docs are named after the deliverable title (e.g. `D1.1.1 — Report Requisiti tecnici …`),
  nested under a folder per OR/WP and a `Deliverables` folder inside each.
- **Share the folder with the SA first**: the service account
  (`959497083111-compute@developer.gserviceaccount.com`) must be an Editor on the project's
  Drive folder — or a member of the Shared Drive — *before* the first run. The seed resolves
  Drive up front, so an unshared folder aborts the run before any Supabase write (no
  half-seeded workspace). The SA key lives at `~/sa.json`; prod wrappers auto-detect it only
  at `/tmp/sa.json`, so `cp ~/sa.json /tmp/sa.json` first.
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

## Seeding a new project plan from a PDF (the full workflow)

This is how a grant/project-plan PDF becomes a live prod workspace. `swich-mars` and `aegis`
are the worked examples; the steps below are the repeatable recipe. Each `.mjs` step is built
behind fast-mode review gates (recon → spec → build → verify) so the *structure* is approved
before code is written and *evidence* is shown before it's called done — but the mechanical
shape is always the same.

### 0. What you hand over

- **The project-plan PDF** — the bando / "Relazione tecnica" / "Piano di Lavoro". This is the
  single source of truth for all seeded content.
- **A Google Drive folder link** (optional) — where the deliverable docs should live. Share it
  with the SA first (see the Drive section above).

### 1. Read the PDF → extract the skeleton

From the plan I pull a structured outline (the only inputs the seeder needs):

| Field | Where in a typical plan | Used for |
|---|---|---|
| Project title | "Titolo progetto" | workspace name + doc header |
| Work packages | "Tabella riassuntiva Work Package" + per-WP pages | WP anchor cards + sub-boards |
| WP option (RI / SS / both) | "Opzione" column | card description label |
| WP start/end dates | "Data presunta di inizio/fine" | card `start_date` / `target_date` |
| Tasks per WP (Tx.y) | "Attività previste" | task cards |
| Deliverables (Dx.y) | "Risultati attesi" / "Deliverable" | deliverable subtask cards + Drive docs |
| Partners / leads | "Soggetti … coinvolti", capofila | WP owner tags + doc subtitles |
| Milestones | a milestone table if present, else **derived** from WP end dates + the named mid-term/closure deliverables | `milestones` pinned to the parent board |

Conventions baked in (owner's standing preferences): board + docs in **English** even when the
bando is Italian; default owner `team@innovina.it`; cards seeded **unowned in Todo** as a
template the team self-assigns from; dates use the plan's real calendar dates.

### 2. Build the deliverable-doc template

Add a project entry to `build-templates.py` (`name`, `sub`, `partners`, optional `lead`) and
build just that one:

```bash
python3 scripts/seeds/build-templates.py <key>     # writes templates/<key>.docx
```

It clones the ARISE skeleton and swaps in the project header. By default `Innovina` → `Inspire`
(the M.A.R.S. convention); set `"lead": "Innovina"` to **keep** the Innovina identity (as AEGIS
does, since Innovina is its capofila). The body keeps `[DOCUMENT TITLE]` / `[Document subtitle]`
placeholders — the seeder fills those per deliverable at upload time.

### 3. Write the seeder `scripts/seeds/<name>.mjs`

Copy an existing project seeder (`swich-mars.mjs` or `aegis.mjs`) and replace only the content
arrays (`WORK_PACKAGES`, `MILESTONES`) with the extracted data. The machinery is unchanged:
`SEED_ENV_FILE` preamble → `findUser(SEED_EMAIL)` → optional `setupDrive()` → for each WP, an
**anchor card** on the parent board + a **sub-board** (`parent_board_id` + `parent_card_id`) →
task cards → deliverable subtasks (each with a yellow card-scope `links` row pointing at its
Google Doc) → milestones pinned to the parent board. Add a catalog row to this README.

### 4. Write the prod ops scripts

- `seed-<name>-prod.sh` — reads the service-role key from a **file** (never argv/history),
  validates it's `service_role` for the right project ref, runs a read-only probe
  (REST status + owner exists + duplicate-workspace check), then seeds via `SEED_ENV_FILE`.
- `delete-<name>-prod.sh` — resolves the workspace by **name + owner at runtime** (newer
  scripts) or hardcoded UUIDs (older ones), triple-guards the delete (id + name + owner), and
  verifies it's gone. FK CASCADE drops boards/cards/links/milestones/members.

Both `.sh` are **gitignored by convention** (prod-ops, like `set-prod-env.sh`).

### 5. Test bed — local DB + real Drive, before prod

Run the real seeder against the **local** dev DB with Drive pointed at the real folder:

```bash
# SEED_ENV_FILE = a temp file with the LOCAL supabase url/key + GOOGLE_SA_KEYFILE=~/sa.json
# + SEED_EMAIL set to an existing @innovina.it local user
SEED_ENV_FILE=/tmp/<name>-bed.env node scripts/seeds/<name>.mjs
```

This creates the **actual** Google Docs (prod reuses them later — stable URLs). Verify a doc is
native + title-filled (Drive export), verify a rerun no-ops, then delete the local workspace
row. **Never `supabase db reset` the dev DB** — it wipes real dev data.

### 6. Seed prod

```bash
cp ~/sa.json /tmp/sa.json                 # wrappers auto-detect the SA key here
printf '%s' 'sb_secret_…' > /tmp/srk.txt  # prod service-role key, file only
bash scripts/seeds/seed-<name>-prod.sh /tmp/srk.txt [--reset]
shred -u /tmp/srk.txt                      # and /tmp/sa.json when done seeding
```

`--reset` wipes the existing workspace first (cascade) — without it, the seed no-ops if the
workspace already exists.

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
