-- Allow the authenticated app user path to stay membership-checked while
-- giving the server-side cron route a service-role path.
create or replace function public.scan_board_sla(p_board_id uuid)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_active int;
begin
  -- Caller must be a board member unless this is the server-side cron
  -- worker using the service-role key.
  if coalesce(auth.role(), '') <> 'service_role'
    and not exists (
      select 1 from public.board_members bm
      where bm.board_id = p_board_id and bm.user_id = auth.uid()
    )
  then
    raise exception 'forbidden';
  end if;

  -- Resolve breaches for cards now archived.
  update public.card_sla cs
    set resolved_at = now()
    where cs.board_id = p_board_id
      and cs.resolved_at is null
      and exists (
        select 1 from public.cards c
        where c.id = cs.card_id and c.archived = true
      );

  -- Insert breach rows for each policy/card combo that crossed target.
  insert into public.card_sla (card_id, sla_id, board_id, started_at, breached_at)
  select c.id, p.id, c.board_id, c.created_at, now()
  from public.cards c
  join public.sla_policies p on p.board_id = c.board_id
  where p.board_id = p_board_id
    and p.enabled = true
    and c.archived = false
    and (extract(epoch from now() - c.created_at) / 60) > p.target_min
    and not exists (
      select 1 from public.card_sla cs
        where cs.card_id = c.id and cs.sla_id = p.id
    )
  on conflict (card_id, sla_id) do nothing;

  select count(*)::int into v_active
    from public.card_sla cs
    where cs.board_id = p_board_id
      and cs.resolved_at is null;

  return v_active;
end$$;

revoke all on function public.scan_board_sla(uuid) from public;
grant execute on function public.scan_board_sla(uuid) to authenticated;
grant execute on function public.scan_board_sla(uuid) to service_role;
