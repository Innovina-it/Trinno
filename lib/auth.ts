import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";

export async function getSessionToken(): Promise<string | null> {
  const supa = await createSupabaseServer();
  // Verify the JWT signature first (network call to Supabase Auth).
  // Returning getSession()'s token without prior verification would let a
  // forged cookie reach dbAsUser, which decodes claims without verifying.
  const { data: u } = await supa.auth.getUser();
  if (!u.user) return null;
  const { data: s } = await supa.auth.getSession();
  return s.session?.access_token ?? null;
}

export async function getUser() {
  const supa = await createSupabaseServer();
  const { data } = await supa.auth.getUser();
  return data.user;
}

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
