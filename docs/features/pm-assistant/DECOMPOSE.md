# PMA — Decompose (Gate B approved)

Status: **DECOMPOSE / Gate B approved** · Tier 3 · Storage = Google Drive API only
Date: 2026-06-07 · See [DESIGN.md](./DESIGN.md)

## Units (file-ownership boundaries)

> U1 split into U1a (Drive) / U1b (Gemini) so the Drive half isn't blocked by the pending Gemini-auth decision.

| # | Unit | Owns (files) | Depends | Slice |
|---|---|---|---|---|
| **U1a** | Drive client + env | `lib/pma/clients/drive.ts`, `.env.local.example`, env schema, `package.json` (`googleapis`→runtime dep) | — | Foundation |
| **U1b** | Gemini client | `lib/pma/clients/gemini.ts` (+ dep per Path A/B) | — (auth decision) | Foundation |
| **U2** | Output-folder link (config) | migration `0128` (link `purpose`), `actions/*link*`, `components/workspace/workspace-settings-form.tsx`, reuse `LinkEditDialog` | U1a | Foundation |
| **U3** | Baseline `is_approved` | migration `0129`, `lib/db/schema.ts`(baseline), "mark Approved" UI, `getApprovedBaseline()` | — | Foundation |
| **U4** | Registry + run-index + Drive output helpers | migration `0130` (`pma_file_registry`,`pma_analysis_runs`), `schema.ts`(pma), `lib/pma/output.ts`, `lib/pma/registry.ts` | U1a | Core |
| **U5** | Detect + categorize (A,B) | `lib/pma/detect.ts` | U1a,U2,U4 | Core |
| **U6** | Version gate + analyze (C,D) | `lib/pma/analyze.ts` (Gemini Flash recap → Output folder) | U1b,U4,U5 | Core |
| **U7** | Aggregate + report Doc (E) | `lib/pma/synthesize.ts` (Gemini Pro report → Google Doc in Output) | U1b,U3,U4,U6 | Core |
| **U8** | Registry update + reconcile (G) | `lib/pma/reconcile.ts` | U4,U6,U7 | Core |
| **U9** | Run orchestration | `app/api/pma/run/route.ts` (owner/admin gate, precondition, wires A→G) | U5,U6,U7,U8 | Wiring |
| **U10** | Analysis tab UI | new tab + Run button + run list → report Doc link | U4,U9 | Wiring |
| **U11** | Verification / tripwires | tests on the 2 SA-shared test folders | U1–U10 | Verify |

## Dependency graph
```
U1a ─┬─► U2 ─────────────┐
     └─► U4 ─┬─► U5 ─► U6 ─┼─► U7 ─► U8 ─► U9 ─► U10 ─► U11
U3 ──────────┘            │
U1b ──────────────────────┘  (U6/U7 need Gemini; U7 needs U3 baseline)
```

## Shared write-sets / integration points
- `lib/db/schema.ts` — U2, U3, U4 → serialize schema edits / section-owned.
- Migrations `0128`(U2) / `0129`(U3) / `0130`(U4) — second-to-land rebases.
- **Link infra reuse (U2)**: must NOT break the existing cloud-icon "Shared folder (link)"; `purpose` defaults existing rows to `source`.
- **U9 contract seam**: `detect()/analyze()/synthesize()/reconcile()` signatures fixed in U1a/U1b/U4 before U5+.

## Dispatch order (WIP ≤ 2 unverified units)
```
Wave 1  U1a            [U3 parallel-safe]      ← Drive fully unblocked
Wave 2  U2 , U4
Wave 3  U5
Wave 4  U1b , U6       ← needs Gemini auth decision (Path A/B)
Wave 5  U7 , U8
Wave 6  U9
Wave 7  U10
Wave 8  U11
```

## Tripwires (added at U11)
existing workspace link unchanged · write-only-to-Output (never writes Source) · owner/admin-only run · idempotent `(fileId,version)` · registry rebuildable from Drive · version-gate skips unchanged.

## Provisioning status (2026-06-07)
| Item | Status |
|---|---|
| Drive API enabled | ✅ |
| SA + two shared test folders | ✅ |
| Gemini auth | ✅ Path B — AIza key (SDK `@google/generative-ai`); set in `.env.local` (rotate — exposed) |
| Rotate leaked keys | ⬜ user, post-build |

## Test fixtures (SA-shared Drive folders)
- **Source** (project content): folder id `1RI4P1hLK622dhlqD2IcUiMcSbnr_W4xa`
- **Output** (Gemini outcome): folder id `1XhMBEasXnniAvO66n6Wxr_iAc7QgUESW`
- SA: `959497083111-compute@developer.gserviceaccount.com` · creds at `.secrets/pma-sa.json` (gitignored)

## Build progress (2026-06-08)
FOUNDATION COMPLETE (verified + committed, no push):
- ✅ U1a Drive client (64de07d) · ✅ U4b output helpers (cf37dd7) · ✅ U4a registry+runs (9cf9e96)
- ✅ U3 baseline is_approved (4651047) · ✅ U2 link purpose source|reports (d9f6635)
- Migrations applied: 0128 registry · 0129 baseline approved · 0130 link purpose · **0131 pma_workspace_state** (U9 infra — additive table for `changes_page_token`; applied local, RLS member-read verified).
- Local Supabase: reset ONCE when empty → full chain 0001→0130. Incremental only since (`supabase migration up --local`, NEVER reset — see [[dev-db-no-reset]]).

CORE IN PROGRESS (verified + committed, no push):
- ✅ U5 detect (a614e4b) — `lib/pma/detect.ts`. Stateless: bootstrap (getStartPageToken + full list) then incremental changes.list; `listFolder(source)` is the scope oracle (drive-wide feed has no parents → excludes Output churn). Returns `newPageToken` for U9 to persist. 11 unit tests (drive mocked). Live-Drive + removed-scoping deferred to U11/U8.
- ✅ U1b Gemini client (553d3a6) — `lib/pma/clients/gemini.ts`. `generateStructured()` over **`@google/genai`** (DEVIATION: locked design said deprecated `@google/generative-ai`; approved swap). Flash+Pro tiers. 7 unit tests + live smoke (real key OK). Contract: schemas must use genai `Type` enum.
- ✅ U6 analyze (6f14b54) — `lib/pma/analyze.ts`. Version gate + per-editable-file Flash recap → `recaps/{fileId}__{version}.json` in Output. Reads registry (never writes — U8 owns). Per-file failure → status=error, batch continues. Deliverable flag from detect cross-ref (not model). 8 unit tests + live exportText smoke (1714 chars from real Doc).
  - **GATE KEY CORRECTION (applies to U5/U1a too):** Google-native editable docs return `headRevisionId=null`; the monotonic **Drive `version`** field is the gate key (probed version=9; revisions.list exposes only 1). `version` now threaded through `drive.ts` (FILE_FIELDS+DriveFile) and `detect.ts` (DetectedFile). Added **`drive.exportText`** (files.export → text/plain|csv) as U6's content source.
  - KNOWN GAPS for later units: (a) registry rows are snake_case at runtime vs camelCase type — `analyze` reads `last_version` defensively; **U8 must fix the registry read/write casing**. (b) `version` bumps on metadata-only edits → occasional harmless re-analyze. (c) no true content-diff (recap from current text).

- ✅ U7 synthesize (THIS COMMIT) — `lib/pma/synthesize.ts`. Aggregates analyze() recaps + missed/removed + Approved baseline-vs-LIVE variance → Gemini **Pro** structured report → **createReport** Google Doc in Output `analyses/`. **Grounded deviation:** reuses `compareToBaseline` (`lib/baselines/compare.ts`) so date/scope/order deltas are computed in code; Gemini only narrates them (can't invent a slip). Returns report + Doc pointer + `counts{changed,missed,removed}`; NEVER writes registry/run-row (U8/U9 own step G). Gemini failure THROWS (terminal for the run; U9 catches). `renderReportDoc` emits plain text → Drive converts to a native Doc. 7 unit tests (Gemini+Output mocked, compareToBaseline real). Full PMA suite 33/33 green.
  - DEVIATIONS from the original seam note: (a) `synthesize` takes `baseline: BaselineDetail | null` + `live` as args (orchestrator U9 fetches via `getApprovedBaseline`→detail + live roadmap) rather than calling `getApprovedBaseline(token)` itself — keeps the unit token-free + testable, mirrors how `analyze` injects its deps. (b) Doc named `Analysis — {runLabel}` (human UTC+1 label passed in) instead of `{run_id}__{date}` — run_id only exists after U9's recordRun; webViewLink is the durable pointer anyway.

- ✅ U8 reconcile (THIS COMMIT) — `lib/pma/reconcile.ts` + registry casing fix. Step G: upserts the registry projection from detect+analyze+removed, then `recordRun`. State rules: analyzed→active+ADVANCE last_version+recap pointer+last_analyzed_at; skipped→active, version unchanged; non_mod→active metadata only; **error→state=error, last_version LEFT UNTOUCHED so it retries next run**; removed→state=removed **only for ids already in the registry** (intersect via `listRegistry` — drops the drive-wide/Output-churn phantoms detect() deferred here). `now` + `triggeredBy` injected (deterministic). Returns `{registered,errored,removedApplied,run}`.
  - **CASING FIX (U6's flag, landed here):** `registry.ts` now maps supabase snake_case rows → camelCase via pure `mapRegistryRow`/`mapRunRow` applied at all 5 read/write return sites — so `row.sourceFileId`/`row.lastVersion` actually have values (reconcile's removed-intersection depends on it). analyze's defensive `last_version ?? lastVersion` read still works, left as-is. Timestamps stay ISO strings at runtime (pre-existing repo-wide supabase quirk, out of scope). 11 unit tests (9 reconcile + 2 mapper). Full PMA suite 44/44 green.

IN PROGRESS — U9 (resume here):
- ✅ U9 infra (THIS COMMIT) — migration `0131_pma_workspace_state` (additive table, applied local + RLS verified) + `registry.getWorkspacePageToken`/`setWorkspacePageToken` + `schema.pmaWorkspaceState`. Token storage decision: **dedicated pma_workspace_state table** (user pick — lowest DB risk, service-role write / member read, room for future cron state).
- ⬜ U9 route (`app/api/pma/run/route.ts`) — owner/admin gate, precondition (both folders configured/shared), wires A→G: load token → detect→analyze→**synthesize**→**reconcile**, persists `changes_page_token` via `setWorkspacePageToken`, calls `getApprovedBaseline`+detail + **live roadmap builder (NEW — no existing LiveEntry[] producer; build from current cards)** to feed synthesize, catches synthesize throw → `runStatus="error"` + `report=null` into reconcile (still records a failed run). Pass a single `now` ISO + `triggeredBy` (acting user) through synthesize.runLabel + reconcile.now. Source/output folder ids: read `links` by `purpose` (source|reports) → `extractDriveFileId(url)`.
- U10 Analysis tab UI · U11 tripwires.
- Resume protocol: read DESIGN.md + this file; continue at U9; per-unit Gate 3 handoff → build → Gate 4 verify (local incremental) → commit. GEMINI_API_KEY (AIza…) is set in .env.local; live Drive test folders in DECOMPOSE "Test fixtures".
