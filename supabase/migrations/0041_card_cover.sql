-- Plan #16b-γ-C (#2) — card cover (color or image).
--
-- Two-column representation: `cover_kind` is a small text-with-check enum
-- (kept text rather than postgres enum so adding new kinds — gradient,
-- pattern, etc. — never requires a migration), and `cover_value` carries
-- either a hex shade or a Storage path. `kind = 'none'` means the cover
-- is unset and `cover_value` is ignored at render time.
--
-- Image uploads reuse the existing `card-attachments` Storage bucket and
-- store the resulting path directly in `cover_value` (no separate
-- attachment row — keeping the cover orthogonal to the user-visible
-- attachment list).

alter table public.cards
  add column cover_kind text check (cover_kind in ('none','color','image')) default 'none' not null,
  add column cover_value text;
