# Harvest — card-edit-concurrency

## 2026-06-12 — point 3 of the foundational systems, accepted at Gate 4

**What shipped:** `edit_rev` counter on cards (bumped by a trigger ONLY on real title/description change), an opt-in `expectedEditRev` fence in the single write path (`updateCardImpl`) returning a `VERSION_CONFLICT` that carries the current text, and a keep-mine/take-theirs dialog wired into the three text-edit surfaces (card-modal title+description, card-tile rename, quick-view batched Save) + roadmap quick-view. Migration applied to LOCAL DEV ONLY; preview/prod is Ali's deploy step.

**Lessons:**
1. **A thrown StructuredError loses its context across the server-action boundary.** The conflict payload (current text + rev) had to be RETURNED via a result-style action (`updateCardChecked` + `actionResult`), not thrown. Any feature that needs structured error DATA at the client (not just a code) must return, not throw.
2. **Optimistic baselines must be FROZEN at edit-start, read LIVE nowhere.** The user-found bug: the quick-view read `card.editRev` at Save time, so a realtime echo advanced its baseline between open and Save → a genuinely stale Save adopted the fresh rev and clobbered the other user with no conflict. Fix: snapshot the rev at open (useState initializer, body keyed by card.id). The cold-review's monotonic-liveRevRef fix in card-modal is the same lesson from the other direction (an optimistic local patch must never LOWER a rev our own save advanced).
3. **Self-conflict is the silent UX killer.** Title onBlur + description debounce fire independent saves; without refreshing the known rev from each save's response, a user conflicts with their own typing. Every successful checked save now writes the returned editRev back to the store and advances the per-field baselines.
4. **My e2e covered the modal but NOT the quick-view** — and the quick-view is exactly what the user reached for first. The bug lived in the untested surface. Lesson: when a feature touches N surfaces, the e2e must exercise each surface's distinct save path, not just the canonical one.
5. **A Tier-3 cold observer with no build context caught the self-conflict class** the author's own tests missed (they were green on the happy path). The independent adversarial read paid for itself.

**Process notes:**
- Gate 3.5 rollback dry-run (down-migration executed on dev, schema + 1483 cards verified intact, re-applied) — cheap insurance, did its job.
- An incomplete `git add` left `updateCardChecked` uncommitted after U3 (working tree ran fine, clean checkout would break). Caught by a routine `git status` review. Lesson: after a multi-file unit, diff `git status` against the unit's write-set before declaring done.

**Deferred (documented, no data loss):** quick-view field-label heuristic can mislabel which field conflicted on a mixed title+description batch; roadmap non-conflict checked-save doesn't revert the optimistic patch (realtime corrects it). Both minor.
