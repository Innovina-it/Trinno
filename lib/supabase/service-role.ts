import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const serviceRoleEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

let cached: SupabaseClient | undefined;

function build(): SupabaseClient {
  const env = serviceRoleEnvSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
  return createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );
}

// Lazy: module-level construction tripped Next's page-data collect on
// `vercel build` when env vars weren't visible yet ("supabaseUrl is required").
// First call constructs; subsequent calls return the cached instance.
export function getServiceSupabase(): SupabaseClient {
  if (!cached) cached = build();
  return cached;
}

// Same client, but returns null when env isn't configured instead of throwing.
// Used by paths that have a documented degradation (e.g. profile search falls
// back to RLS-scoped results when service role is absent in dev).
export function tryGetServiceSupabase(): SupabaseClient | null {
  if (cached) return cached;
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return null;
  }
  cached = build();
  return cached;
}
