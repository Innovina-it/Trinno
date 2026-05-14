-- Auth domain allowlist.
--
-- Optional gate for internal-team deployments: reject signups whose email
-- does NOT match an approved domain.
--
-- Reference:
-- https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook
--
-- Configure Supabase Studio -> Authentication -> Hooks ->
-- Before User Created to call public.auth_block_external_domains.

create or replace function public.auth_block_external_domains(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- One or more allowed domains. Lowercase. Comma-separated.
  allowed_domains text[] := array['innovina.it'];
  email text;
  email_domain text;
begin
  email := event->'user'->>'email';
  email_domain := lower(split_part(coalesce(email, ''), '@', 2));

  if email_domain is null or email_domain = '' then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 400,
        'message', 'Email is required.'
      )
    );
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
