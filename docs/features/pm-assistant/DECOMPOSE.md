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

## Build progress (2026-06-07)
FOUNDATION COMPLETE (verified + committed, no push):
- ✅ U1a Drive client (64de07d) · ✅ U4b output helpers (cf37dd7) · ✅ U4a registry+runs (9cf9e96)
- ✅ U3 baseline is_approved (4651047) · ✅ U2 link purpose source|reports (d9f6635)
- Migrations applied: 0128 registry · 0129 baseline approved · 0130 link purpose.
- Local Supabase: reset ONCE when empty → full chain 0001→0130. Incremental only since (`supabase migration up --local`, NEVER reset — see [[dev-db-no-reset]]).

REMAINING (resume here):
- U5 detect (Changes API over source folder + categorize + deliverable cross-ref) — verify READY: a Google Doc is now in the Source folder 1RI4P1….
- U1b + U6 Gemini analyze — needs real GEMINI_API_KEY (AIza…) in .env.local; SDK @google/generative-ai.
- U7 synth report (Gemini Pro → report Doc in output folder) · U8 reconcile · U9 run route (owner/admin) · U10 Analysis tab UI · U11 tripwires.
- Resume protocol: read DESIGN.md + this file; continue at U5; per-unit Gate 3 handoff → build → Gate 4 verify (local incremental) → commit.
