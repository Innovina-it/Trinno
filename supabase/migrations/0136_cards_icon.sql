-- milestone-as-card (U2) — additive, non-destructive.
-- Cards gain an optional `icon` (emoji) used by milestone-type cards on the
-- roadmap marker label. Null for every existing/non-milestone card, so card
-- behavior is unchanged. The milestone color reuses the existing cover_color.
ALTER TABLE cards ADD COLUMN icon text;
