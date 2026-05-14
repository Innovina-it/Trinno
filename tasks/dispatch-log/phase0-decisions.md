# Phase 0 Decisions — Sheet1 Execution Plan

**Date**: 2026-05-14
**Source**: docs/superpowers/specs/2026-05-14-sheet1-claude-execution-plan.md (§ Phase 0)
**Policy applied**: all decisions left at spec's "default if undecided" per the kickoff prompt's instruction.

| Id | Decision | Value | Notes |
|---|---|---|---|
| D0.1 | Epic → sub-board mapping rule | **1:1 lift** | Each `type='epic'` card becomes one sub-board with parent set to the epic's current board. Children re-parent to the new sub-board. New row records `_migrated_from_epic_id`. Applied in dispatch 1a (migration 0100). |
| D0.2 | Epic-grep allowlist | spec default | Historical migrations; filenames containing `epic_to_subboard` or `_migrated_from_epic_`; CHANGELOG; dated `docs/` entries; test fixtures named `epic_migration_*.test.ts`; the constant `MIGRATED_FROM_EPIC_ID`. Everything else removed/renamed. |
| D0.3 | Guest / shared-workspace permission matrix | spec default | Guest = read-only on Home + assigned boards; can comment on cards assigned to them; notifications only for direct mentions/assignments. Not bound to Wave 1–3 dispatches; relevant to dispatch 10. |
| D0.4 | "Empty all Version Data" | OUT OF SCOPE | Spec default: out of scope until owner specifies. Do not implement. |
| D0.5 | Keyboard shortcut `C` | spec default | Scope to Board context only; suppressed when focus is inside `input`, `textarea`, or `[contenteditable]`. Relevant to dispatch 10. |
| D0.6 | Cross-tab auth event contract | spec default | Single `BroadcastChannel('trinno-auth-v1')`. Event union: `'signed-in' \| 'signed-out' \| 'token-refreshed' \| 'session-expired'`. No second channel allowed. Applies to dispatch 5. |
| D0.7 | Sub-board rollout strategy | spec default | Feature flag `subboards_enabled` (workspace-level). Old Epic UI removed code-wise; new sub-board UI gated. Migration runs always. Discovered during dispatch 1a: repo has no existing workspace-level feature-flag mechanism — 1b will design or escalate. |

## Outstanding
- D0.7 implementation detail: workspace flag mechanism does not yet exist. Dispatch 1b is asked to either (a) add a minimal flag column/storage or (b) escalate if scope exceeds 1b's writeset.
