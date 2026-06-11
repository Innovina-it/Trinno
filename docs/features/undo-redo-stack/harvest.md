# Harvest — undo-redo-stack (rolling)

## 2026-06-11 — feature built end-to-end in one authorized autonomous run

**What happened:** 8 units (A1→A2→B1→B2→C1→C2→E1→D1) built, tested, committed individually. The byte-compatible `push()` bet from recon paid off exactly as predicted — 41 board sites gained multi-step undo with zero edits.

**Lessons:**
1. **Full-page `goto` wipes the in-memory bus — by design, but it bit the evidence spec.** Cross-surface undo only holds across CLIENT-SIDE navigation. The e2e spec now documents this; any future "undo doesn't work after navigation" bug report should first ask: was it a hard reload?
2. **ID rebirth is the recurring trap for redo of create/delete pairs.** Solved three times (milestone create, milestone delete, card-link add/remove) with the same mutable-`currentId`-in-closure pattern. If a fourth case appears, extract a helper.
3. **The repo's gantt-drag e2e suite is dead on arrival locally:** its signup helper uses `@example.com`, rejected by the email-domain hook (auth.spec.ts even documents the restriction). All 7 tests fail at signup. Fixing the domain would revive a 35KB drag-regression suite for free — high-leverage follow-up.
4. **Failed undos used to be silently swallowed;** under a redo stack that mis-files them as redoable. E1 added rethrows at every touched site. Pattern for new sites: optimistic patch → server write → on failure revert + toast + RETHROW.

**Proposed tripwire (needs Gate 5 approval before registry):** keep `tests/e2e/undo-redo-stack.spec.ts` in the standing e2e set — it catches: hotkey regressions, focus-guard breakage (people losing typing undo), banner-contract drift, and cross-surface bus breakage. Owner: ali.
