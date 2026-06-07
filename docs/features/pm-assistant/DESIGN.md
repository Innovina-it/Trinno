# Project Management Assistant (PMA) — Detailed Design

Status: **DESIGN / Gate A (awaiting approval)** · no code yet
Author: AI-assisted (ai-dev-control workflow)
Date: 2026-06-07
Storage model: **Google Drive API only — no GCS, no BigQuery, no Supabase Storage.**
Decisions locked: Drive shared folders via service account · whole-folder scan with deliverables emphasised · **two Drive folders in workspace settings (source + trinno-managed output)** · Postgres registry as a rebuildable projection (keys/index only) · manual button trigger (no cron, no delivery) · **Gemini API (Google AI Studio)** for recap + synthesis · `roadmap_baselines.is_approved` baseline.

---

## 1. Spec core

| | |
|---|---|
| **Goal** | Give a workspace an on-demand "Analysis" run that scans its linked Google Drive **source folder** (project content + deliverables), uses Gemini to recap what changed in editable documents (deliverables called out specially), synthesises a report comparing progress against the **Approved** roadmap baseline, and writes that report as a **Google Doc into a second, trinno-managed Drive output folder**. Reports are listed in a new Analysis tab. |
| **Done looks like** | A workspace owner/admin opens the **Analysis** tab (next to Deliverables), presses **Run analysis**, and after the run a new report appears in the list, linking to its **Google Doc in the output Drive folder**. The report contains: an executive summary, a dedicated **deliverables** paragraph, notable changes, missed updates, and deviations vs the Approved baseline. Re-pressing only analyses what changed since the previous run. |
| **Must not change** | Existing notification/digest, roadmap, board/list/card, and `links` behaviour must keep working. **No bulk content in Postgres** — system of record is the Drive output folder; the Postgres registry stays **rebuildable from Drive**. Service-account + Gemini secrets never reach the client. The run is gated to workspace owner/admin. RLS on all new tables is workspace-scoped. trinno only **writes** to the output folder, never the source folder. |

**Build tier: 3 (load-bearing).** First Google Drive integration and first LLM (Gemini) in the codebase. New prod secrets (Drive service account, `GEMINI_API_KEY`), external data egress to Gemini, and a new outbound-content governance surface. Full gates apply.

---

## 2. Recon findings, reuse map & env

Recon (2026-06-07): no Google Drive / Gemini / GCS / LLM in prod code (`googleapis` is an unused devDependency). Stack: Next.js 15.5 · React 19 · Drizzle 0.45 · Supabase Postgres · Vercel. Next migration **0128**. Workspace + roles + RLS exist (`lib/db/schema.ts:49-71`); `roadmap_baselines` exists (migration 0122) but has **no approved marker**; `links` table holds deliverable links on cards (read-only here).

| Concern | Reuse | Genuinely new |
|---|---|---|
| Scan source | **existing workspace "Shared folder (link)"** (cloud icon, `upsertWorkspaceLink` scope=`workspace`) — already present | Drive connection + sync over it |
| Report storage | **same link infra** (`LinkEditDialog` + `upsertWorkspaceLink`, owners/admins-edit auth) | a **2nd link** (Output folder), same authorization |
| Deliverable identification | read existing `links` table | match folder fileIds → deliverable links |
| Baseline | `roadmap_baselines` structure | **`is_approved` flag** (admin-set) |
| Registry/index | — | **Postgres registry** (projection of Drive, keys/index only) |
| Synthesis / delta / deviation | — | **Gemini API (Google AI Studio)** |
| Trigger + history UI | workspace tab pattern | **Analysis tab** (Run button + report list) |
| ~~Delivery~~ | — | **Removed** — report is in-app via the Analysis tab only |

**New env / auth split (only two secrets):**
- One **service-account JSON** authenticates the **Drive API** for both **reading the source folder** and **writing the output folder** — referenced via a gitignored path (`GOOGLE_APPLICATION_CREDENTIALS=.secrets/pma-sa.json`). Scope: `https://www.googleapis.com/auth/drive` (read source + write output), limited in practice to folders shared with the SA.
- **`GEMINI_API_KEY`** (Google AI Studio key, `AIza…`), SDK `@google/generative-ai`.
- Secrets live in `.env.local` (local, gitignored) + `vercel env` (prod). Any key pasted into chat = compromised → rotate. **No GCS credential.**

---

## 3. Filtering, Detection & Trigger Workflow

Three nested gates — **type → novelty → version** — so we never deep-scan a type we can't synthesise and never re-analyse an unchanged file.

**Trigger:** a **Run analysis** button in the new **Analysis** tab, gated to workspace **owner/admin**. The run is **incremental** — only changes since the previous run's checkpoint. No cron (deferred), no notification delivery (removed).

**Detection:** Drive **Changes API** over the **source folder**. Per connection we persist `changes_page_token`; `changes.list` returns only what changed since the last token; the new token is saved at run end as an idempotent checkpoint. First run bootstraps with `changes.getStartPageToken` + a one-time `files.list` to seed the registry.

```
RUN ANALYSIS  (Analysis tab · owner/admin · base = SOURCE Drive folder)
  │   precondition: BOTH source + output Drive folders configured & shared to the SA
  │
  ├─ A. DETECT  (Drive Changes API over the SOURCE folder)
  │     load changes_page_token (bootstrap full-list if none)
  │     changes.list → added / edited / removed / trashed since last token
  │     persist new page_token   (= "since previous analysis" checkpoint)
  │
  ├─ B. CATEGORIZE  (runtime; NOT persisted on the links table)
  │     class = mimeType → editable | non_mod
  │        EDITABLE = application/vnd.google-apps.{document,spreadsheet,presentation}
  │        NON-MOD  = pdf, png, jpg, office files, everything else
  │     is_deliverable = fileId matches a links-table deliverable link (read-only cross-ref)
  │     → NON-MOD  → registry/metadata only (no deep scan)
  │     → EDITABLE → gate C  (deliverable or not — all editable files analysed)
  │
  ├─ C. VERSION GATE  (cost control — cheap Postgres lookup)
  │     if drive headRevisionId/version > registry.last_version → enqueue for analysis
  │     else → SKIP (no Gemini call, no cost)
  │
  ├─ D. ANALYZE  (per changed editable file — §5)
  │     no files.export / no local diff; leverage the document's revision history
  │       (fallback: fetch current content once + diff against last stored recap)
  │     → Gemini per-file recap + importance/quality judgment (structured JSON)
  │     → write recap as a file in the OUTPUT folder (recaps/{fileId}__{version}.json)
  │     → deliverables tagged is_deliverable=true → feed the special paragraph
  │     → failure → state=error → "missed update"
  │
  ├─ E. AGGREGATE + DEVIATION  (workspace level — §5)
  │     collect recaps + missed/error + removed files
  │     load the "Approved" roadmap_baseline → compare vs the LIVE roadmap
  │     → Gemini synthesis → report
  │     → CREATE a Google Doc in the OUTPUT folder (the report; deliverables paragraph inside)
  │
  └─ G. UPDATE REGISTRY  (sync Postgres registry from the Drive output folder + source listing)
        versions, kind, is_deliverable, state, last_analyzed_at, Drive fileId pointers
        record the run in pma_analysis_runs (→ report Doc webViewLink)
        (NO delivery step)
```

**New vs replaced file:** Drive keys on stable `fileId`, never name. Replace-in-place keeps `fileId` → **edit**. New upload (even same name) → new `fileId`. Delete-then-reupload = old `fileId` trashed + new `fileId` appears (both arrive in the changes feed) → **the deliverable's stored card link is updated to the new document**. (Auto-creation of "New Deliverable" cards is **out of scope**.)

---

## 4. Data & Storage Strategy

**System of record = the Drive OUTPUT folder** (trinno-managed Gemini documents). **Postgres holds only keys / kind / pointers** — a registry that is a **rebuildable projection** of what's in Drive.

### 4.0 Last-change date — read from Drive, not stored
Drive's catalog already carries the change date: `files.list`/`files.get`/Changes feed return **`modifiedTime`** (display) and **`headRevisionId`/`version`** (the gate — survives metadata-only edits). The registry stores only **our** last-processed `version`/`last_analyzed_at` to diff against Drive's current value. No separate timestamp store.

### 4.1 Two Drive folders (workspace settings — reuse existing link infra)
Both are **workspace links** managed by `LinkEditDialog` + `upsertWorkspaceLink`, with the existing authorization (**visible to all members, editable only by owners/admins**). The **Source** link already exists (the cloud-icon "Shared folder (link)"). The **Output** link is **new but identical in auth** — implemented by adding a `purpose` discriminator (`source` | `reports`) so one workspace can hold both.

| Folder | purpose | Direction | Contents | SA access |
|---|---|---|---|---|
| **Source** | `source` (existing) | read | project content + deliverables | Viewer/Commenter |
| **Output** | `reports` (new, same auth) | write | trinno-managed Gemini documents (recaps + reports) | Editor / Content manager |

The service account must be shared on **both** folders.

### 4.2 Output-folder layout (trinno creates the substructure)
```
[Output Drive folder]/
  recaps/{sourceFileId}__{version}.json   per-file Gemini recap + judgment
  analyses/{run_id}__{date}  (Google Doc)  the run report (deliverables paragraph inside)
```
Naming recaps by `fileId__version` makes the registry reconstructable by listing this folder.

### 4.3 Postgres `pma_file_registry` (projection of Drive — keys/kind/pointers only)
| col | type | notes |
|---|---|---|
| id | uuid PK | |
| workspace_id | uuid FK | RLS-scoped |
| source_file_id | text | Drive fileId in the SOURCE folder; unique per workspace |
| name, parent_folder_id, mime_type | text | |
| kind | enum | `editable` \| `non_mod` (computed each run) |
| is_deliverable | bool | matched against `links` |
| card_link_id | uuid null | the deliverable link/card it maps to |
| last_version | text | headRevisionId — the version-gate checkpoint |
| last_analyzed_at | timestamptz | |
| state | enum | `active` \| `removed` \| `error` |
| recap_file_id | text null | Drive fileId of the latest recap in the OUTPUT folder |
| updated_at | timestamptz | |

Rebuildable from Drive (list source + output folders). Powers: cheap version gate, deletion/orphan detection, missed-update reconciliation, in-app workspace-scoped queries, idempotency, future cron.

### 4.4 Postgres `pma_analysis_runs` (run-history index for the Analysis tab)
`id · workspace_id · run_at · triggered_by · status · counts(jsonb: changed/missed/removed) · report_file_id · report_web_view_link → the report Google Doc`.

### 4.5 Operational keys
`changes_page_token` + the two Drive-folder links live on the workspace record / settings. No payload.

### 4.6 Baseline
`roadmap_baselines` gains **`is_approved`** (one Approved version per workspace, admin-set). Deviation = Approved baseline vs the **live** roadmap (titles, start/target/completed dates, sprint).

---

## 5. AI Processing Pipeline (Gemini API — Google AI Studio)

Two call types: cheap model for volume, capable model for synthesis.

### 5.1 Per-file delta recap → Gemini **Flash**
- **No `files.export`, no local diff.** Source the change from the document's revision history (Drive Revisions API). Fallback if revision content isn't fetchable: fetch current content once + diff against last stored recap.
- **Structured output** (`responseSchema`): `{ additions[], edits[], structural_changes[], one_line_summary, recap[], quality_judgment, importance, risk_flags[], is_deliverable }`.
- Write to the OUTPUT folder `recaps/{fileId}__{version}.json`. Idempotent on `(fileId, version)`. Failure → `state=error` → "missed update".

### 5.2 Workspace synthesis → Gemini **Pro**
- **Inputs:** all per-file recap JSONs (read back from the output folder or in-memory) + missed/error list + removed files + the Approved `roadmap_baseline` structured plan.
- **Outputs (structured):**
  ```
  { executive_summary,
    deliverables_focus,        // dedicated paragraph on deliverable files — changes, quality, plan impact
    notable_changes[], new_or_changed_files[], missed_updates[],
    deviations:[{item, baseline_value, current_value, type: delay|scope|reorder, severity}],
    progress_notes[], difficulties[] }
  ```
- **Grounded deviation:** Gemini receives baseline dates/completion vs live roadmap → compares against data, not vibes.
- **Output:** rendered into a **Google Doc created in the OUTPUT folder** (human-readable; deliverables paragraph included). Surfaced in the Analysis tab via its `webViewLink`. **No delivery to email/Telegram/in-app.**

---

## 6. UI — Analysis tab

A new **Analysis** tab in the workspace tab bar, adjacent to **Deliverables**.

```
[ Board ] [ Roadmap ] [ Deliverables ] [ Analysis ]
                                         └─────────┐
  ┌──────────────────────────────────────────────────────────┐
  │  [ ▶ Run analysis ]   (owner/admin · disabled until both   │
  │                        Drive folders are configured)       │
  │  Past analyses                                            │
  │  • 2026-06-07 14:32 (UTC+1) — 4 changed, 1 missed  → Doc↗ │
  │  • 2026-06-05 09:10 (UTC+1) — 2 changed            → Doc↗ │
  └──────────────────────────────────────────────────────────┘
```
- Run button gated to owner/admin; list readable by members (RLS), read from `pma_analysis_runs`.
- Each row opens that run's **report Google Doc** in the output folder.
- Timestamps in **UTC+1**. Visual quality governed by the `impeccable` skill at build time.

---

## 7. Locked decisions

| Decision | Value | Rationale |
|---|---|---|
| Storage | **Google Drive API only** | No GCS / BigQuery / Supabase Storage |
| Folders | **Source (existing cloud-icon link) + Output (new, same auth)** via `upsertWorkspaceLink` + `purpose` discriminator | trinno writes only to output |
| Change-date source | Drive `modifiedTime`/`headRevisionId` | no separate timestamp store |
| Scan scope | Whole **source** folder (all files) | deliverables emphasised, not isolated |
| Deliverable emphasis | Dedicated **paragraph** in report | match vs `links` table at runtime |
| Categorization | Runtime by `mimeType` | no flag on `links` table |
| Deep-scan target | **Editable only** (Google native) | non-mod = metadata only |
| Delta gate | `headRevisionId`/version vs registry | avoids metadata-only false positives |
| System of record | **Drive output folder** | Gemini docs managed by trinno.app |
| Postgres | **Registry + run index only** | keys/kind/pointers; rebuildable from Drive |
| Baseline | `roadmap_baselines.is_approved` vs **live** roadmap | admin-set Approved version |
| Trigger | **Button** (owner/admin), incremental | no cron (deferred) |
| Delivery | **None** | report in Analysis tab only |
| Drive auth | **Service account**, scope `drive` (read+write) | shared-folder-limited |
| Gemini auth | **`GEMINI_API_KEY`** (`AIza…`) | SDK `@google/generative-ai` |
| Timezone | **UTC+1** | |

---

## 8. Out of scope (this milestone)
Cron/scheduled automation · notification delivery of reports · "New Deliverable" auto card-creation · deep-scan/OCR of non-modifiable files · AI cost tuning / large-workspace batching / cron-timeout handling · GCS / BigQuery / Supabase Storage / pgvector.

## 9. Provisioning preconditions (gate verification, not code)
| Precondition | Where | For |
|---|---|---|
| Rotate the leaked keys (SA key + sk-proj) | GCP IAM / OpenAI | security |
| Real Gemini key (`AIza…`) | aistudio.google.com | Gemini |
| **Drive API** enabled | project `python-272518` | Drive |
| **Two test folders** shared to the SA (source ≥ Viewer, output = Editor) | Drive | unit-test fixture (user offered to provide) |
| SA is least-privilege (not default Compute SA) | GCP IAM | recommended |

## 10. Blast radius (estimate)
New: ~2 migrations (registry+run index; baseline `is_approved`), 2 external clients (Drive read+write, Gemini), Drive output-folder helpers, registry sync/reconcile, 1 orchestration route, 1 UI tab + 2 config fields. Touches workspace config + roadmap-baseline UI. **Tier 3 — full gates, decompose into vertical slices, WIP ≤ 2 unverified units.**
