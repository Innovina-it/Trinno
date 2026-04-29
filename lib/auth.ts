import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";

// React cache() dedupes within a single request. Without this every
// requireUser/getSessionToken call hits Supabase Auth again.
export const getUser = cache(async () => {
  const supa = await createSupabaseServer();
  const { data } = await supa.auth.getUser();
  return data.user;
});

export const getSessionToken = cache(async (): Promise<string | null> => {
  const user = await getUser();
  if (!user) return null;
  const supa = await createSupabaseServer();
  const { data } = await supa.auth.getSession();
  return data.session?.access_token ?? null;
});

export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireSession() {
  const supa = await createSupabaseServer();
  const { data } = await supa.auth.getSession();
  if (!data.session) redirect("/login");
  return data.session;
}
