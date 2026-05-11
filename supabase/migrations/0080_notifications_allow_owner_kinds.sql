alter table public.notifications
  drop constraint if exists notifications_kind_check;

alter table public.notifications
  add constraint notifications_kind_check check (kind in (
    'comment.mention',
    'comment.create',
    'card.assigned',
    'card.unassigned',
    'card.owner_assigned',
    'card.owner_unassigned',
    'card.archived',
    'card.unarchived',
    'card.moved',
    'card.due',
    'card.dates',
    'card.label.added',
    'card.linked',
    'card.sprint_changed',
    'board.member.added'
  ));
