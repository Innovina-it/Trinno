-- Opt-in workspace setting: when true, creating a card auto-inserts a
-- card_members row for the creator. Off by default to match Trello/Jira
-- semantics where a freshly drafted card has no assignee.

alter table public.workspaces
  add column if not exists auto_assign_creator boolean not null default false;
