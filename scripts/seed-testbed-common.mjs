// Shared helpers for testbed seed scripts.
// All testbed seeds share one user + one workspace so a single login
// gives the Chrome agent access to every fixture.

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env.local") });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !service) throw new Error("missing supabase env (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)");

export const admin = createClient(url, service, { auth: { persistSession: false } });

export const TESTBED_EMAIL = "testbed@local";
export const TESTBED_PASSWORD = "testbed-seed-2026";
export const TESTBED_WORKSPACE_NAME = "Testbed";

export const TESTBED_MEMBER_EMAIL = "testbed-member@local";
export const TESTBED_MEMBER_PASSWORD = "testbed-seed-2026";

export async function ensureUser(email, password) {
  const { data: list, error: listErr } = await admin.auth.admin.listUsers();
  if (listErr) throw listErr;
  let existing = list.users.find((u) => u.email === email);
  if (!existing) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    existing = data.user;
    console.log(`created user ${email}`);
  } else {
    await admin.auth.admin.updateUserById(existing.id, { password });
  }
  return existing.id;
}

export async function ensureWorkspace(userId, name = TESTBED_WORKSPACE_NAME) {
  const { data: existing } = await admin
    .from("workspaces")
    .select("id, feature_flags")
    .eq("name", name)
    .maybeSingle();
  if (existing) return existing;
  const { data, error } = await admin
    .from("workspaces")
    .insert({ name, owner_id: userId, feature_flags: {} })
    .select("id, feature_flags")
    .single();
  if (error) throw error;
  await admin
    .from("workspace_members")
    .upsert({ workspace_id: data.id, user_id: userId, role: "owner" }, { onConflict: "workspace_id,user_id" });
  console.log(`created workspace "${name}"`);
  return data;
}

export async function setWorkspaceFlag(workspaceId, flag, value) {
  const { data: ws, error: readErr } = await admin
    .from("workspaces")
    .select("feature_flags")
    .eq("id", workspaceId)
    .single();
  if (readErr) throw readErr;
  const next = { ...(ws.feature_flags ?? {}), [flag]: value };
  const { error } = await admin
    .from("workspaces")
    .update({ feature_flags: next })
    .eq("id", workspaceId);
  if (error) throw error;
  console.log(`set workspaces.feature_flags[${flag}] = ${value}`);
}

export async function ensureMembership(workspaceId, userId, role = "member") {
  const { error } = await admin
    .from("workspace_members")
    .upsert(
      { workspace_id: workspaceId, user_id: userId, role },
      { onConflict: "workspace_id,user_id" },
    );
  if (error) throw error;
  console.log(`ensured ${role} membership ${userId} in ${workspaceId}`);
}

export async function findOrCreateBoard(workspaceId, title, userId, extra = {}) {
  const { data: existing } = await admin
    .from("boards")
    .select("id, title")
    .eq("workspace_id", workspaceId)
    .eq("title", title)
    .maybeSingle();
  if (existing) return existing.id;
  const { data, error } = await admin
    .from("boards")
    .insert({ workspace_id: workspaceId, title, created_by: userId, ...extra })
    .select("id")
    .single();
  if (error) throw error;
  console.log(`created board "${title}"`);
  return data.id;
}

export async function findOrCreateList(boardId, title, position = "a000000") {
  const { data: existing } = await admin
    .from("lists")
    .select("id, title")
    .eq("board_id", boardId)
    .eq("title", title)
    .maybeSingle();
  if (existing) return existing.id;
  const { data, error } = await admin
    .from("lists")
    .insert({ board_id: boardId, title, position })
    .select("id")
    .single();
  if (error) throw error;
  console.log(`created list "${title}"`);
  return data.id;
}

export function rankString(n, width = 6) {
  return "a" + String(n).padStart(width, "0");
}
