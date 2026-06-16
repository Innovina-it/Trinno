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
