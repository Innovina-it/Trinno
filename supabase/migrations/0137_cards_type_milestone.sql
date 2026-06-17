-- milestone-as-card (U2) — widen the cards.type CHECK to allow 'milestone'.
-- Additive/non-destructive: only broadens the allowed set; existing rows
-- (story/task/subtask/bug) stay valid. Mirrors CardType in lib/validation.ts.
ALTER TABLE cards DROP CONSTRAINT cards_type_check;
ALTER TABLE cards ADD CONSTRAINT cards_type_check
  CHECK (type = ANY (ARRAY['story'::text, 'task'::text, 'subtask'::text, 'bug'::text, 'milestone'::text]));
