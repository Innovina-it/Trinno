alter table public.cards add column story_points int check (story_points is null or (story_points >= 0 and story_points <= 999));
create index on public.cards (sprint_id, story_points) where sprint_id is not null and story_points is not null;
