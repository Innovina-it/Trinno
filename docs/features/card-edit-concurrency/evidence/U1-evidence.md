# Evidence — U1 migration (card-edit-concurrency)

Unit: U1 · Tier 3 · Verifier: claude + Ali at gates · Date: 2026-06-12
Environment: LOCAL dev supabase only (127.0.0.1:54322). Preview/prod NOT touched.

Applied: supabase migration up → 0134 tracked local-only (migration list: local 0134 | remote blank | applied 0134 — remote blank is CORRECT, prod untouched).
Functional probe (pinned card id, superuser psql):
  - same-value title write → rev unchanged (0)
  - real title change → rev 1; restore → rev 2 (every real change counts)
  - position write → rev unchanged (scoped trigger works; drags/moves can never false-conflict)
Gate 3.5 rollback dry-run EXECUTED on dev:
  - rollback-0134.sql → column, trigger, function all gone; 1483 cards intact
  - re-applied 0134 → schema restored, all revs reset to 0 (documented: a real rollback discards conflict tokens, which is their nature — no data loss)
Known gaps: preview env migration state not yet checked (deploy-time precondition, Ali-triggered); revs reset on rollback (accepted).
Decision: PASS.
