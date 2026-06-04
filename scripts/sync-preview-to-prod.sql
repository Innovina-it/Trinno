-- =====================================================================
-- Schema sync: PREVIEW  ->  PROD   (ADDITIVE ONLY — non-destructive)
-- Generated 2026-06-03 by diffing live schemas (read-only):
--   preview = tuqteqyerfdwqouofzdq
--   prod    = xndddfopnlrzkydtnjxo
--
-- VERIFIED BEFORE GENERATION:
--   * prod has ZERO objects that preview lacks (no DROP needed, no risk
--     of dropping prod-only data).
--   * Source dump contains NO DROP / ALTER COLUMN TYPE / SET NOT NULL.
--   * All FK targets (workspaces, cards, lists, boards, profiles,
--     auth.users) and the workspace_role enum + is_workspace_admin /
--     is_workspace_member helper fns ALREADY EXIST in prod.
--
-- PROPERTIES:
--   * Idempotent — safe to run more than once (IF NOT EXISTS / OR REPLACE
--     / guarded DO blocks / DROP POLICY IF EXISTS).
--   * PART 1 runs in one transaction; nothing is dropped from existing
--     prod objects, so existing data is untouched.
--
-- RUN AGAINST PROD ONLY. Review first. Recommended:
--   psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 -f scripts/sync-preview-to-prod.sql
-- =====================================================================

-- =====================================================================
-- PART 1 — public schema (safe, run with the standard `postgres` role)
-- =====================================================================
BEGIN;

-- ---------- 1. ENUM ----------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'link_scope' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.link_scope AS ENUM ('workspace', 'card');
  END IF;
END $$;

-- ---------- 2. TRIGGER FUNCTIONS (CREATE OR REPLACE = idempotent) ----------
CREATE OR REPLACE FUNCTION public.handle_invite_accept() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
begin
  if new.email_confirmed_at is not null
     and old.email_confirmed_at is null then
    update public.workspace_invitations
       set status = 'accepted',
           accepted_at = now()
     where status = 'pending'
       and (user_id = new.id or lower(email) = lower(new.email));
  end if;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION public.links_set_workspace_id() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  new.updated_at := now();
  if new.scope = 'card' then
    -- always derive (overwrite any caller-supplied value) for card-scope links
    select b.workspace_id into new.workspace_id
      from public.cards c
      join public.boards b on b.id = c.board_id
      where c.id = new.card_id;
    if new.workspace_id is null then
      raise exception 'links: cannot resolve workspace for card %', new.card_id;
    end if;
  end if;
  return new;
end$$;

-- ---------- 3. TABLES (created in FK-dependency order) ----------
CREATE TABLE IF NOT EXISTS public.roadmap_baselines (
    id          uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name        text NOT NULL,
    note        text,
    created_by  uuid NOT NULL,
    created_at  timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT roadmap_baselines_pkey PRIMARY KEY (id),
    CONSTRAINT roadmap_baselines_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT roadmap_baselines_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id)
);

CREATE TABLE IF NOT EXISTS public.roadmap_baseline_entries (
    baseline_id    uuid NOT NULL,
    card_id        uuid NOT NULL,
    title          text NOT NULL,
    start_date     timestamp with time zone,
    target_date    timestamp with time zone,
    completed_at   timestamp with time zone,
    roadmap_order  integer,
    sprint_id      uuid,
    parent_card_id uuid,
    CONSTRAINT roadmap_baseline_entries_pkey PRIMARY KEY (baseline_id, card_id),
    CONSTRAINT roadmap_baseline_entries_baseline_id_fkey FOREIGN KEY (baseline_id) REFERENCES public.roadmap_baselines(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.roadmap_baseline_assignees (
    baseline_id uuid NOT NULL,
    card_id     uuid NOT NULL,
    user_id     uuid NOT NULL,
    CONSTRAINT roadmap_baseline_assignees_pkey PRIMARY KEY (baseline_id, card_id, user_id),
    CONSTRAINT roadmap_baseline_assignees_baseline_id_fkey FOREIGN KEY (baseline_id) REFERENCES public.roadmap_baselines(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.roadmap_baseline_milestones (
    baseline_id  uuid NOT NULL,
    milestone_id uuid NOT NULL,
    name         text NOT NULL,
    date         timestamp with time zone,
    CONSTRAINT roadmap_baseline_milestones_pkey PRIMARY KEY (baseline_id, milestone_id),
    CONSTRAINT roadmap_baseline_milestones_baseline_id_fkey FOREIGN KEY (baseline_id) REFERENCES public.roadmap_baselines(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.links (
    id          uuid DEFAULT gen_random_uuid() NOT NULL,
    scope       public.link_scope NOT NULL,
    workspace_id uuid NOT NULL,
    card_id     uuid,
    url         text NOT NULL,
    color       text,
    created_by  uuid NOT NULL,
    created_at  timestamp with time zone DEFAULT now() NOT NULL,
    updated_at  timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT links_pkey PRIMARY KEY (id),
    CONSTRAINT links_scope_shape CHECK (
      (((scope = 'workspace'::public.link_scope) AND (card_id IS NULL) AND (color IS NULL))
       OR ((scope = 'card'::public.link_scope) AND (card_id IS NOT NULL)))
    ),
    CONSTRAINT links_card_id_fkey FOREIGN KEY (card_id) REFERENCES public.cards(id) ON DELETE CASCADE,
    CONSTRAINT links_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id),
    CONSTRAINT links_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
-- realtime change-tracking parity with preview
ALTER TABLE public.links REPLICA IDENTITY FULL;

CREATE TABLE IF NOT EXISTS public.workspace_invitations (
    id          uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    email       text NOT NULL,
    role        public.workspace_role NOT NULL,
    invited_by  uuid NOT NULL,
    user_id     uuid,
    status      text DEFAULT 'pending'::text NOT NULL,
    created_at  timestamp with time zone DEFAULT now() NOT NULL,
    accepted_at timestamp with time zone,
    CONSTRAINT workspace_invitations_pkey PRIMARY KEY (id),
    CONSTRAINT workspace_invitations_role_check CHECK (
      (role = ANY (ARRAY['admin'::public.workspace_role, 'member'::public.workspace_role, 'guest'::public.workspace_role]))
    ),
    CONSTRAINT workspace_invitations_status_check CHECK (
      (status = ANY (ARRAY['pending'::text, 'accepted'::text, 'revoked'::text]))
    ),
    CONSTRAINT workspace_invitations_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.profiles(id) ON DELETE CASCADE,
    CONSTRAINT workspace_invitations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
    CONSTRAINT workspace_invitations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);

-- ---------- 4. cards.pre_done_list_id (new nullable column + FK) ----------
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS pre_done_list_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cards_pre_done_list_id_fkey'
      AND conrelid = 'public.cards'::regclass
  ) THEN
    ALTER TABLE public.cards
      ADD CONSTRAINT cards_pre_done_list_id_fkey
      FOREIGN KEY (pre_done_list_id) REFERENCES public.lists(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ---------- 5. INDEXES ----------
CREATE UNIQUE INDEX IF NOT EXISTS links_card_ux ON public.links USING btree (card_id) WHERE (scope = 'card'::public.link_scope);
CREATE INDEX        IF NOT EXISTS links_card_ws_idx ON public.links USING btree (workspace_id) WHERE (scope = 'card'::public.link_scope);
CREATE UNIQUE INDEX IF NOT EXISTS links_ws_ux ON public.links USING btree (workspace_id) WHERE (scope = 'workspace'::public.link_scope);
CREATE INDEX        IF NOT EXISTS roadmap_baselines_ws_idx ON public.roadmap_baselines USING btree (workspace_id, created_at DESC);
CREATE INDEX        IF NOT EXISTS workspace_invitations_email_idx ON public.workspace_invitations USING btree (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS workspace_invitations_pending_uq ON public.workspace_invitations USING btree (workspace_id, email) WHERE (status = 'pending'::text);
CREATE INDEX        IF NOT EXISTS workspace_invitations_workspace_idx ON public.workspace_invitations USING btree (workspace_id);

-- ---------- 6. TABLE TRIGGER ----------
DROP TRIGGER IF EXISTS links_set_workspace_id_biu ON public.links;
CREATE TRIGGER links_set_workspace_id_biu
  BEFORE INSERT OR UPDATE ON public.links
  FOR EACH ROW EXECUTE FUNCTION public.links_set_workspace_id();

-- ---------- 7. ROW LEVEL SECURITY (enable + policies) ----------
ALTER TABLE public.links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS links_admin_write ON public.links;
CREATE POLICY links_admin_write ON public.links
  USING (public.is_workspace_admin(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_admin(workspace_id, auth.uid()));
DROP POLICY IF EXISTS links_select ON public.links;
CREATE POLICY links_select ON public.links
  FOR SELECT USING (public.is_workspace_member(workspace_id, auth.uid()));

ALTER TABLE public.roadmap_baselines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS roadmap_baselines_admin_write ON public.roadmap_baselines;
CREATE POLICY roadmap_baselines_admin_write ON public.roadmap_baselines
  USING (public.is_workspace_admin(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_admin(workspace_id, auth.uid()));
DROP POLICY IF EXISTS roadmap_baselines_select ON public.roadmap_baselines;
CREATE POLICY roadmap_baselines_select ON public.roadmap_baselines
  FOR SELECT USING (public.is_workspace_member(workspace_id, auth.uid()));

ALTER TABLE public.roadmap_baseline_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS roadmap_baseline_entries_admin_write ON public.roadmap_baseline_entries;
CREATE POLICY roadmap_baseline_entries_admin_write ON public.roadmap_baseline_entries
  USING (EXISTS (SELECT 1 FROM public.roadmap_baselines b
                 WHERE b.id = roadmap_baseline_entries.baseline_id
                   AND public.is_workspace_admin(b.workspace_id, auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.roadmap_baselines b
                 WHERE b.id = roadmap_baseline_entries.baseline_id
                   AND public.is_workspace_admin(b.workspace_id, auth.uid())));
DROP POLICY IF EXISTS roadmap_baseline_entries_select ON public.roadmap_baseline_entries;
CREATE POLICY roadmap_baseline_entries_select ON public.roadmap_baseline_entries
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.roadmap_baselines b
                 WHERE b.id = roadmap_baseline_entries.baseline_id
                   AND public.is_workspace_member(b.workspace_id, auth.uid())));

ALTER TABLE public.roadmap_baseline_assignees ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS roadmap_baseline_assignees_admin_write ON public.roadmap_baseline_assignees;
CREATE POLICY roadmap_baseline_assignees_admin_write ON public.roadmap_baseline_assignees
  USING (EXISTS (SELECT 1 FROM public.roadmap_baselines b
                 WHERE b.id = roadmap_baseline_assignees.baseline_id
                   AND public.is_workspace_admin(b.workspace_id, auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.roadmap_baselines b
                 WHERE b.id = roadmap_baseline_assignees.baseline_id
                   AND public.is_workspace_admin(b.workspace_id, auth.uid())));
DROP POLICY IF EXISTS roadmap_baseline_assignees_select ON public.roadmap_baseline_assignees;
CREATE POLICY roadmap_baseline_assignees_select ON public.roadmap_baseline_assignees
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.roadmap_baselines b
                 WHERE b.id = roadmap_baseline_assignees.baseline_id
                   AND public.is_workspace_member(b.workspace_id, auth.uid())));

ALTER TABLE public.roadmap_baseline_milestones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS roadmap_baseline_milestones_admin_write ON public.roadmap_baseline_milestones;
CREATE POLICY roadmap_baseline_milestones_admin_write ON public.roadmap_baseline_milestones
  USING (EXISTS (SELECT 1 FROM public.roadmap_baselines b
                 WHERE b.id = roadmap_baseline_milestones.baseline_id
                   AND public.is_workspace_admin(b.workspace_id, auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.roadmap_baselines b
                 WHERE b.id = roadmap_baseline_milestones.baseline_id
                   AND public.is_workspace_admin(b.workspace_id, auth.uid())));
DROP POLICY IF EXISTS roadmap_baseline_milestones_select ON public.roadmap_baseline_milestones;
CREATE POLICY roadmap_baseline_milestones_select ON public.roadmap_baseline_milestones
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.roadmap_baselines b
                 WHERE b.id = roadmap_baseline_milestones.baseline_id
                   AND public.is_workspace_member(b.workspace_id, auth.uid())));

ALTER TABLE public.workspace_invitations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_invitations_admin_write ON public.workspace_invitations;
CREATE POLICY ws_invitations_admin_write ON public.workspace_invitations
  USING (public.is_workspace_admin(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_admin(workspace_id, auth.uid()));
DROP POLICY IF EXISTS ws_invitations_select ON public.workspace_invitations;
CREATE POLICY ws_invitations_select ON public.workspace_invitations
  FOR SELECT USING (public.is_workspace_admin(workspace_id, auth.uid()));
DROP POLICY IF EXISTS ws_invitations_select_own ON public.workspace_invitations;
CREATE POLICY ws_invitations_select_own ON public.workspace_invitations
  FOR SELECT USING (user_id = auth.uid());

-- ---------- 8. GRANTS (Supabase API roles — REQUIRED or PostgREST 403s) ----------
-- Matches preview: anon/authenticated/service_role get ALL; RLS (section 7)
-- is what actually gates row access. Idempotent.
GRANT ALL ON TABLE public.links                        TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.roadmap_baselines            TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.roadmap_baseline_entries     TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.roadmap_baseline_assignees   TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.roadmap_baseline_milestones  TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.workspace_invitations        TO anon, authenticated, service_role;

-- ---------- 9. REALTIME (parity: links is published in preview) ----------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'links'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.links;
  END IF;
END $$;

COMMIT;

-- =====================================================================
-- PART 2 — PRIVILEGED (review + run separately; may need elevated role)
-- ---------------------------------------------------------------------
-- These touch objects outside `public`. With Supabase, the `postgres`
-- role can usually create them via a DIRECT (5432) connection; if you
-- hit a permission error, run them from the Supabase SQL editor.
-- =====================================================================

-- 2A. Invitation auto-accept: trigger on auth.users.
--     WITHOUT this, rows in workspace_invitations are never auto-marked
--     'accepted' when a user confirms their email. Functional parity gap.
DROP TRIGGER IF EXISTS on_auth_user_confirmed ON auth.users;
CREATE TRIGGER on_auth_user_confirmed
  AFTER UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_invite_accept();

-- 2B. OPTIONAL security hardening — event trigger that auto-enables RLS
--     on every newly created public table. This is a BEHAVIOR CHANGE
--     (affects all future DDL on prod). Omit if you don't want it.
CREATE OR REPLACE FUNCTION public.rls_auto_enable() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtname = 'ensure_rls') THEN
    CREATE EVENT TRIGGER ensure_rls ON ddl_command_end EXECUTE FUNCTION public.rls_auto_enable();
  END IF;
END $$;
