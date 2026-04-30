alter table public.lists add column wip_limit int
  check (wip_limit is null or (wip_limit > 0 and wip_limit <= 999));
