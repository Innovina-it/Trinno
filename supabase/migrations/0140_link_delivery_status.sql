-- 2026-06-18 — Delivery status tag on card deliverables. Card-scope links gain
-- an optional `status` (To do / In progress / Delivered / Approved / Blocked),
-- a tag SEPARATE from the Open/Done completion logic (cards.completed_at /
-- due_complete are untouched). Nullable: existing rows and all workspace-scope
-- links backfill to NULL (no status = no badge), so nothing changes for them.
-- No index touched — the card (links_card_ux) and workspace (links_ws_ux)
-- uniqueness indexes are left exactly as-is.

do $$ begin
  create type public.delivery_status as enum
    ('to_do', 'in_progress', 'delivered', 'approved', 'blocked');
exception when duplicate_object then null;
end $$;

alter table public.links
  add column if not exists status public.delivery_status;

-- Backfill: every existing card-scope link gets 'to_do' so all deliverables
-- start with a visible status (matching the dialog's default). Idempotent and
-- scoped: only NULL card rows are touched — a status already set is never
-- overwritten, and workspace-scope links stay NULL (status is card-only).
update public.links
  set status = 'to_do'
  where scope = 'card' and status is null;
