# errors-onboarding — DECOMPOSE

## Units

### U1 — action-result boundary helper
- Write-set: `lib/errors/action-result.ts` (new), `lib/errors/index.ts` (re-export), `tests/unit/action-result.test.ts` (new)
- Read-set: `lib/errors/structured-error.ts`
- Goal: ship `actionResult<T>(fn): Promise<Result<T>>` wrapper returning `{ok:true, data:T} | {ok:false, error:StructuredErrorShape}`; maps thrown Error→ACTION_FAILED; passes StructuredError through; never throws.
- Risk: low.

### U2 — server-side coding (throws only)
- Write-set: `actions/*.ts` (23 files); `tests/unit/action-error-codes.test.ts` (new); `tests/integration/forbidden-codes.test.ts` (new)
- Read-set: U1 output, `lib/auth`, drizzle schema
- Goal: every `throw new Error(...)` in `actions/` becomes `throw new StructuredError(CODE, msg, context?)`. Exported wrappers UNCHANGED — still throw. Caller behaviour preserved.
- Done: `grep "throw new Error\\(" actions/` = 0; tests assert thrown code via `.rejects.toMatchObject({ code: ... })`.
- Risk: medium blast.
- Decisions: Q-A default to `ACCESS_DENIED` for "Card not found" sites inside `dbAsUser(token,...)` (RLS info-leak guard). Q-B squash commit.

### U3 — wrapper migration + UI consumption (merged)
- Write-set: `actions/*.ts` (exported wrappers convert to `actionResult(() => impl(...))`); 26 component caller sites that read action return value; `components/error-pane.tsx`; `lib/errors/copy.ts` (new); `lib/errors/error-bus.ts`; ~22 `errorBus.push` call sites; `tests/integration/error-pane-codes.spec.ts` (new playwright)
- Read-set: U2 outputs
- Goal: exported actions return `ActionResult<T>`; ErrorPane branches copy on code; 8 spec scenarios pass.
- Risk: high blast — wrapper-shape change requires atomic caller update (M2).

### U4 — seeder report surface
- Write-set: `actions/seed.ts` (kill `safe()`); `app/(auth)/auth/callback/route.ts`; `components/seed-failure-banner.tsx` (new); `app/(app)/layout.tsx` (mount); `tests/integration/seed-partial-report.test.ts` (new)
- Read-set: U1, U2, U3
- Goal: partial seed → banner naming failed steps.
- Risk: medium.

## Dependency map (revised after caller-surface scan)
```
U1 ─→ U2 ─→ U3 ─→ U4
```
U4 depends on U3 because the seed failure banner pushes through the code-aware errorBus.

## Dispatch order
- Wave 1: U1 solo → Gate 4 ✓ DONE
- Wave 2: U2 solo → Gate 4
- Wave 3: U3 solo → Gate 4
- Wave 4: U4 solo → Gate 4
- Then Gate 5 Harvest

WIP limit: 1 unit at a time. OK.

## Tripwires (T1-T5)
- T1. `grep "throw new Error\\(" actions/` → 0
- T2. Every exported action in `actions/*` returns `Result<T>` (TS-level)
- T3. Seed integration test with `__testFailStep` returns `partial=true` AND `failures.length === expected`
- T4. Callback route: failures non-empty → cookie `tr_seed_report` set
- T5. RLS info-leak: `NOT_FOUND` only when row provably exists for someone; else `ACCESS_DENIED`

## Status
- [x] U1 dispatched → commit 77acf76
- [x] U1 verified
- [x] U2 dispatched → commit faaaf9d
- [x] U2 verified
- [x] U3 dispatched → commit 0b905b2 (narrowed scope: 3 of 24 wrappers, see CONTRACT.md)
- [x] U3 verified
- [x] U4 dispatched → commit 233b070
- [x] U4 verified
- [x] Gate 5 harvest
