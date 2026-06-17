-- milestone-as-card (U1) — additive, non-destructive.
-- Adds a `hidden` flag to lists so a board can host a "Milestones" column
-- that never renders on the board. Existing lists default to hidden=false,
-- so board behavior is unchanged. No data moved, no table dropped.
ALTER TABLE lists ADD COLUMN hidden boolean NOT NULL DEFAULT false;
