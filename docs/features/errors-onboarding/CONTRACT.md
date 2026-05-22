# errors-onboarding — CONTRACT

Locked-in invariants and known gaps after the U1-U4 ship cycle. Read before touching `lib/errors/`, `actions/*`, `app/(auth)/auth/callback/`, or `actions/seed.ts`.

## Invariants

### I1. Action throws stay coded
Every `throw` inside `actions/*.ts` MUST be a `StructuredError` with a code from the frozen registry. Plain `throw new Error(...)` is banned.
- **Tripwire**: `grep "throw new Error(" actions/` → 0.
- **Registry**: ACCESS_DENIED, NOT_MEMBER, ROLE_INSUFFICIENT, VALIDATION_ERROR, CONFLICT, SEED_TEST_FAILURE, SEED_STEP_FAILED, ACTION_FAILED. (NOT_FOUND, SEED_PARTIAL exist in the copy table but are not emitted by server actions today — see I4.)

### I2. RLS-default for "row not returned by dbAsUser(token,…)" is ACCESS_DENIED
When an impl can't distinguish "row deleted" from "row never accessible to this user", emit `ACCESS_DENIED`, not `NOT_FOUND`. Emitting `NOT_FOUND` requires proof the row exists globally — which most impls don't have because they run under the caller's token.

### I3. ActionResult<T> wrapper conversion is all-or-nothing per wrapper
Converting an exported action wrapper from `throw` to `actionResult(() => impl(...))` changes its return type. M2 of the SPEC says **no half-migrated callers in main**. Convert the wrapper AND every UI caller in the same commit.

When you convert a wrapper, run:
```
grep -rn "await <fn>(" components/ app/
```
Categorize each hit:
- Return-reading (`const x = await fn(...)`) → must destructure `r.ok` / `r.data`.
- Non-return-reading (`await fn(...)`) → harmless, but if wrapped in `try/catch`, MUST update — catch never fires after conversion.
- `try/catch` callers → MUST replace with `if (!r.ok) errorBus.push({ code, message, context })`.

Run `npm run type-check` after the wrapper change; TS lights up every missed caller.

### I4. Seed step names are user-visible
`SeedFailureBanner` projects `failures[].step` directly into the banner copy. Renaming a step in `actions/seed.ts:seedRichDemoImpl` changes what the user sees. Either keep the names stable or update the visible copy accordingly.
- **Tripwire (manual)**: `grep "safe(" actions/seed.ts` → 0 (the deleted helper must stay deleted).

### I5. Server Action wire transport stripped Error subclass fields
Next 15.5 Server Actions serialize thrown errors to message + digest. `.code`, `.context`, and class identity DO NOT survive the wire. Two consequences:
- **Don't rely on `e instanceof StructuredError`** in client `catch` blocks — it returns false in production.
- **To surface `.code` to the UI**, the wrapper MUST return `ActionResult<T>` (plain JSON, JSON-safe).

## Known gaps (open work for the backlog)

### G1. 21 of 24 candidate wrappers still throw
The 3 converted wrappers are `createList`, `archiveList`, `createCardLink`. The remaining 21 still throw. Their UI callers continue to `try/catch + errorBus.push({ message })` — functional, but ErrorPane shows the fallback "Something went wrong" copy instead of code-specific copy.

Convert opportunistically when the wrapper is touched for another reason. Follow I3.

### G2. SPEC scenario 2 (deleted in tab A, rename in tab B → NOT_FOUND copy) is not delivered
`updateCard` was the obvious choice but has 18 caller sites including complex rollback patterns. Conscious deferral.

### G3. No browser-driven assertion of the SEED_PARTIAL pipeline
`failures[] → cookie → useEffect → bus → ErrorPane` is covered by unit + integration tests per leg, but no playwright spec drives the full chain.

### G4. SeedFailureBanner mount is not rendered in a test
`vitest + jsdom + .tsx` import for the banner hit the same parsing snag observed when trying to render ErrorPane. The exported pure functions (`readSeedReportCookie`, `formatFailedSteps`) ARE unit-tested; the `useEffect` glue is one-line and unverified.

### G5. Tripwires not codified in CI
T1 (no plain throws), T6 (no `safe()` in seed), T7 (every emitted code has a copy entry) are listed here for grep, not in a CI script.

## File map

| Concern | File |
|---|---|
| Error class + code | `lib/errors/structured-error.ts` |
| Result wrapper | `lib/errors/action-result.ts` |
| Client bus | `lib/errors/error-bus.ts` |
| Code → copy lookup | `lib/errors/copy.ts` |
| Pane render | `components/error-pane.tsx` |
| Seeder | `actions/seed.ts` |
| Auth handoff | `app/(auth)/auth/callback/route.ts` |
| Banner | `components/seed-failure-banner.tsx` |
| Banner mount | `app/(app)/layout.tsx` |
