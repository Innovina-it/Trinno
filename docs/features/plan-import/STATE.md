# Feature: Import a project plan — execution state

- **Spec:** `docs/superpowers/specs/2026-06-16-plan-import-wizard-design.md`
- **Plan:** `docs/superpowers/plans/2026-06-16-plan-import-wizard.md`
- **Tier:** 2 (paid API + upload route + Drive writes; DB build RLS-safe per-user; no migration)
- **Lane:** self (all units)
- **Resume with:** "resume plan-import"

## Unit progress

| Unit | File | Tier | Status |
|---|---|---|---|
| U1 | lib/pma/clients/gemini.ts (PDF part) | 2 | done (eb0d2d6) |
| U2 | lib/plan-import/types.ts + genai-schema.ts | 1 | done (4166630) |
| U3 | lib/plan-import/extract.ts | 1 | done (3fc880c) |
| U4 | lib/plan-import/drive-docs.ts | 1 | done (4b97c40) |
| U5 | lib/plan-import/build.ts | 2 | done (bea5eae) |
| U6 | actions/plan-import.ts | 2 | done (d65243e) |
| U7 | app/api/import-plan/extract/route.ts | 2 | done (9492648) |
| U8 | components/import-plan/* + page | 1 | done (e983b13) |
| U9 | scripts/plan-import/extract-smoke.ts | 0 | done (49bf336) |

## UI elevation (next chunk — NOT yet built)
- Design brief confirmed + committed: `docs/features/plan-import/UI-BRIEF.md` (c3f0cf4), via impeccable shape.
- Scope (production-ready, monochrome studio-console): 3-step stepper, real PDF drop-zone, collapsible WP cards (collapsed + mono-meta counts), calendar DatePicker (YYYY-MM-DD↔Date adapter), sticky summary footer, fix the em-dash CTA → "Build workspace".
- Touches: components/import-plan/* (+ maybe a small stepper/footer component). Tier 1-2. Implement under a FRESH ai-dev-control run (decompose into ~5 units: stepper, drop-zone, review redesign, footer+summary, date adapter).
- Resume with: "resume plan-import UI".
- BUILT 2026-06-16 (commits be8443f→d2625b6): date adapter (unit-tested), monochrome stepper, PDF drop-zone, collapsible WP cards + DatePicker + mono-meta counts + sticky summary footer, CTA → "Build workspace". typecheck 0, lint clean, suite 19/19. User confirmed it renders (screenshots).
- Live-test bug fixes: (1) cf86d33 one-shot ref guard in BuildStep — StrictMode dev double-invoke was building 2 workspaces per attempt (4 dup ARISE workspaces cleaned from dev DB). (2) 4e55182 catch-all in the extract route so a failure is logged + returned readable instead of a bare 500/hung spinner.
- OPEN: extract 500 root cause unconfirmed (likely Turbopack rebuild churn during commits); now observable via banner + `[import-plan/extract] failed:` server log. Awaiting a clean user retry to confirm/fix.

## Upload types (broadened 2026-06-16, commit 72b3324)
- Accepts the Gemini-native set: PDF, png/jpeg/webp, text/plain/markdown/csv (lib/plan-import/supported-types.ts is the single allowlist). Office docs rejected with "export as PDF". Exposed in the UI.
- DEFERRED by decision: docx/xlsx auto-conversion. soffice (LibreOffice 24.2) IS on the dev box but NOT on Vercel serverless → an auto-converter would break in hosted prod. Revisit with a serverless converter / cloud API if prod needs Office support.
- DEFERRED: large-file Gemini Files-API path (over the 15 MB inline cap). SDK surface: ai.files.upload + createPartFromUri.

## Review-step features (built this session)
- **Duration control** beside the workspace name: edits the project length (months); rescales every date proportionally from a fixed start (lib/plan-import/rescale.ts, unit-tested). Live/debounced commit.
- **Per-task owner + toggle**: each task has an editable owner, pre-filled at extraction from its WP `lead` (extract.ts inherit). A "Stamp owners" toggle (default on) appends the owner to task card titles ("T1.1 · BE-ST"); WP anchor stays clean. Owner is title text, not owner_id (org isn't an app user). buildWorkspaceFromPlan signature is now (token, plan, { driveFolderId?, applyOwners? }).
- **Fixes**: hydration (steps mount client-only, import-wizard); build no longer hangs (dropped cancelled flag) + hard-navigates via window.location.assign (build-step); duration rescales without clicking out (debounce).

## Env / ops notes
- Dev Supabase URL is a LAN IP now (192.168.68.58:54321), still the local dev DB. Cleanup/seed guards must treat 192.168.* as local (run.sh already does).
- Cleanup after test/stuck-build runs: service-role delete of "Test Plan WS" + "ARISE Project — Project Plan" + planbuild-*@x.io users. Keep real imported workspaces (e.g. "AIWEPI High-Level Prototype — Project Plan").

## Notes / decisions
- WIP limit ≤2 unverified units; Gate 4 evidence before passing each Tier 2 unit.
- Integration test (U5) needs local Supabase (:54321).
- Deploy-config follow-up (not code): GEMINI_API_KEY + GOOGLE_SERVICE_ACCOUNT_JSON in Vercel preview/prod.

## Build conventions discovered (deviations from the plan)
- Tests live under `tests/unit/` and `tests/integration/` (vitest include = `tests/**/*.test.ts`); co-located lib tests are NOT picked up. Import via `@/` alias.
- Any test importing a `server-only` module must `vi.mock("server-only", () => ({}))`.
- `vi.mock` factories that reference a mock fn must use `vi.hoisted` (mock is hoisted above module scope).
- genai `Type` enum values are UPPERCASE ("OBJECT"/"STRING"/"INTEGER"/"ARRAY"); the genai Schema lives in `genai-schema.ts` (separate from client-safe `types.ts`).
- rtk mangles vitest console output → run `rtk proxy npx vitest run <path> --reporter=json --outputFile=/tmp/x.json` and parse.
- **Milestones are a separate `milestones` table, NOT cards** (createMilestoneImpl at actions/milestones.ts:20 inserts there). The "milestone-as-card" memory note is stale for this code path. build.ts uses createMilestoneImpl correctly; test asserts the milestones table.
- Integration tests create dev-DB rows; clean up with a service-role delete of "Test Plan WS" workspaces + planbuild-*@x.io users after runs (never db reset).
