-- Add workspace_members to the realtime publication so the topnav can
-- react when the current user is added to / removed from a workspace.
-- Without this, an invitee never sees their new workspace appear until
-- they hard-reload, because Next's RSC layout payload sits in client
-- cache between soft navigations.

alter publication supabase_realtime add table public.workspace_members;
