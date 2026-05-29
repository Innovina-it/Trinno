-- Domain-gate carve-out: allow signup/user-creation for any email that has
-- a LIVE (pending) workspace invitation. Public /signup for un-invited
-- external emails stays blocked (innovina.it allowlist unchanged).
--
-- This redefines the hook from migration 0056; the function body is
-- identical except for the prepended invitation check.

create or replace function public.auth_block_external_domains(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed_domains text[] := array['innovina.it'];
  v_email text;
  email_domain text;
begin
  v_email := event->'user'->>'email';
  email_domain := lower(split_part(coalesce(v_email, ''), '@', 2));

  if email_domain is null or email_domain = '' then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 400,
        'message', 'Email is required.'
      )
    );
  end if;

  -- Carve-out: an outstanding (pending) invitation authorizes any domain.
  if exists (
    select 1 from public.workspace_invitations wi
     where wi.email = lower(v_email)
       and wi.status = 'pending'
  ) then
    return '{}'::jsonb;
  end if;

  if not (email_domain = any (allowed_domains)) then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', format(
          'Signup is restricted to internal addresses (%s not allowed).',
          email_domain
        )
      )
    );
  end if;

  return '{}'::jsonb;
end;
$$;

grant execute
  on function public.auth_block_external_domains(jsonb)
  to supabase_auth_admin;

revoke execute
  on function public.auth_block_external_domains(jsonb)
  from authenticated, anon, public;
