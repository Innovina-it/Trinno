-- Realtime DELETE events are filtered by board_id/workspace_id in the
-- clients. Postgres only includes primary-key columns in OLD rows unless the
-- table uses REPLICA IDENTITY FULL, so deletes could miss those filters and
-- leave other users with stale cards/lists until a refresh.

alter table public.lists replica identity full;
alter table public.cards replica identity full;
alter table public.labels replica identity full;
alter table public.card_labels replica identity full;
alter table public.card_members replica identity full;
alter table public.checklists replica identity full;
alter table public.checklist_items replica identity full;
alter table public.comments replica identity full;
alter table public.attachments replica identity full;
alter table public.card_links replica identity full;
alter table public.components replica identity full;
alter table public.card_components replica identity full;
alter table public.card_versions replica identity full;
alter table public.sprints replica identity full;
alter table public.versions replica identity full;
