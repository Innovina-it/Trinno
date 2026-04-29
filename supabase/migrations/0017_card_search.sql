alter table public.cards add column tsv tsvector
  generated always as (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A')
    || setweight(to_tsvector('simple', coalesce(description, '')), 'B')
  ) stored;

create index cards_tsv_idx on public.cards using gin (tsv);
