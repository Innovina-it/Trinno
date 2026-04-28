"use server";
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";

export async function logout() {
  const supa = await createSupabaseServer();
  await supa.auth.signOut();
  redirect("/login");
}
