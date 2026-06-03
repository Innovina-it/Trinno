#!/usr/bin/env bash
#
# inspect-0106-deletions.sh — report READ-ONLY di cosa perde 0106_drop_epic_type.sql
# sul DB preview linkato (trinno_preview).
#
# 0106 NON fa DELETE su dati business:
#   - i card type='epic' vengono DEMOTI a 'story' (UPDATE in-place, non cancellati)
#   - perdita righe SOLO da: 3 tabelle audit droppate + 1 colonna droppata
#   - rischio FALLIMENTO (non cancellazione): il nuovo check constraint
#     fallisce se restano card con type fuori da (story,task,subtask,bug)
#
# Questo script apre UNA transazione READ ONLY: non può scrivere nulla.
#
# Uso:
#   ./scripts/inspect-0106-deletions.sh                 # usa il pooler linkato
#   DB_URL="postgresql://..." ./scripts/inspect-0106-deletions.sh   # override

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
POOLER_FILE="$ROOT/supabase/.temp/pooler-url"

# --- Connessione -------------------------------------------------------------
if [[ -z "${DB_URL:-}" ]]; then
  if [[ -f "$POOLER_FILE" ]]; then
    DB_URL="$(tr -d '[:space:]' < "$POOLER_FILE")"
  else
    echo "ERRORE: nessun DB_URL e $POOLER_FILE assente." >&2
    echo "  Esporta DB_URL oppure rilancia 'supabase link --project-ref tuqteqyerfdwqouofzdq'." >&2
    exit 1
  fi
fi

# Maschera la password nel log.
echo "Target preview: $(sed -E 's#://[^@]*@#://***@#' <<<"$DB_URL")"
echo

command -v psql >/dev/null 2>&1 || { echo "ERRORE: psql non installato." >&2; exit 1; }

# --- Report (tutto dentro una sola transazione READ ONLY) --------------------
psql "$DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
\pset pager off
begin;
set transaction read only;   -- garanzia: nessuna scrittura possibile

\echo '============================================================'
\echo ' A. TABELLE DROPPATE (righe 61-63) -> perdita TOTALE righe'
\echo '============================================================'
do $$
declare n bigint; t text;
begin
  foreach t in array array[
    'public.epic_subboard_migrations',
    'public.epic_subboard_migration_lists',
    'public.epic_subboard_migration_cards'
  ] loop
    if to_regclass(t) is not null then
      execute format('select count(*) from %s', t) into n;
      raise notice '% : % righe verranno PERSE (DROP TABLE)', rpad(t,40), n;
    else
      raise notice '% : assente (gia'' droppata o mai creata)', rpad(t,40);
    end if;
  end loop;
end$$;

\echo ''
\echo '============================================================'
\echo ' B. COLONNA DROPPATA boards._migrated_from_epic_id (riga 66)'
\echo '============================================================'
do $$
declare n bigint;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='boards'
      and column_name='_migrated_from_epic_id'
  ) then
    execute 'select count(*) from public.boards where _migrated_from_epic_id is not null' into n;
    raise notice 'boards._migrated_from_epic_id : % valori non-null persi col DROP COLUMN', n;
  else
    raise notice 'boards._migrated_from_epic_id : colonna assente (gia'' droppata)';
  end if;
end$$;

\echo ''
\echo '============================================================'
\echo ' C. CARD DEMOTI epic->story (righe 33-35) -- NON cancellati'
\echo '============================================================'
do $$
declare n bigint;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='cards' and column_name='type'
  ) then
    execute $q$select count(*) from public.cards where type = 'epic'$q$ into n;
    raise notice 'cards type=epic : % card cambiano type in ''story'' (UPDATE in-place)', n;
  else
    raise notice 'cards.type : colonna assente?!';
  end if;
end$$;

\echo ''
\echo " -- elenco card epic (id / title) che verranno demoti:"
select id, title
from public.cards
where type = 'epic'
order by id
limit 200;

\echo ''
\echo '============================================================'
\echo ' D. PREFLIGHT CHECK CONSTRAINT (righe 54-57) -- rischio FALLIMENTO'
\echo '    Dopo il demote, ogni type deve stare in'
\echo "    (story,task,subtask,bug); altrimenti db push FALLISCE (no delete)."
\echo '============================================================'
-- Simula lo stato post-demote: epic conta come story.
select
  case when type = 'epic' then 'story (post-demote)' else type end as type_post_migrazione,
  count(*) as righe,
  case
    when (case when type='epic' then 'story' else type end)
         in ('story','task','subtask','bug')
    then 'OK'
    else '*** VIOLA CONSTRAINT -> migrazione FALLIRA'' ***'
  end as esito
from public.cards
group by 1, (case when type='epic' then 'story' else type end)
order by 1;

\echo ''
\echo '============================================================'
\echo ' E. BACKFILL parent_card_id (righe 26-30) -- UPDATE, no delete'
\echo '============================================================'
do $$
declare n bigint;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='boards'
      and column_name='_migrated_from_epic_id'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='boards'
      and column_name='parent_card_id'
  ) then
    execute $q$
      select count(*) from public.boards b
      where b._migrated_from_epic_id is not null
        and b.parent_card_id is null
        and exists (select 1 from public.cards c where c.id = b._migrated_from_epic_id)
    $q$ into n;
    raise notice 'boards che riceveranno parent_card_id : % (UPDATE, nessuna riga persa)', n;
  else
    raise notice 'boards : colonne necessarie assenti, backfill no-op';
  end if;
end$$;

\echo ''
\echo '============================================================'
\echo ' CONCLUSIONE'
\echo '   Righe business cancellate da 0106 = 0 (nessun DELETE).'
\echo '   Perdita dati = solo sezioni A (tabelle audit) e B (colonna).'
\echo '   Controlla la sezione D: se appare *** VIOLA ***, il push'
\echo '   fallira'' finche'' non sistemi quei type a mano.'
\echo '============================================================'

rollback;   -- niente da committare; chiusura pulita
SQL
