create policy lists_member_insert on public.lists for insert
  with check (exists (
    select 1 from public.board_members bm
    where bm.board_id = lists.board_id and bm.user_id = auth.uid()
  ));

create policy cards_member_insert on public.cards for insert
  with check (exists (
    select 1 from public.lists l
    join public.board_members bm on bm.board_id = l.board_id
    where l.id = cards.list_id and bm.user_id = auth.uid()
  ));
