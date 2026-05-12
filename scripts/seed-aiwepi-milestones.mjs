#!/usr/bin/env node
// Seed milestones for the existing AIWEPI / Switch workspace.
// Idempotent: deletes milestones whose name matches before re-inserting.
//
// Required env:
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   SEED_EMAIL   — the owner whose workspace to target

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

if (process.env.SEED_ENV) {
  config({ path: join(__dirname, "..", process.env.SEED_ENV), override: true });
} else if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  config({ path: join(__dirname, "..", ".env.local") });
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.SEED_EMAIL;

if (!url || !service || !email) {
  throw new Error(
    "Missing env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SEED_EMAIL"
  );
}

const admin = createClient(url, service, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const WORKSPACE_NAME = "AIWEPI - Switch";

const DAY_MS = 86_400_000;
const PROJECT_START = new Date("2025-10-15T09:00:00Z");
const monthStart = (m) =>
  new Date(PROJECT_START.getTime() + (m - 1) * 30 * DAY_MS).toISOString();

// Milestones mapped to the 6 work-package delivery gates.
const MILESTONE_DEFS = [
  {
    name: "M1.1 — Scenario Analysis & SoA Complete",
    date: monthStart(3),
    description: "WP1.1 deliverable D1.1.1 accepted. Operational use-case scenarios and state-of-the-art report finalised.",
    color: "#6366f1",
    icon: "📋",
  },
  {
    name: "M1.2 — Architecture & Requirements Frozen",
    date: monthStart(6),
    description: "WP1.2 & WP1.3 deliverables accepted. Functional, non-functional and interoperability requirements baselined.",
    color: "#0ea5e9",
    icon: "🏗️",
  },
  {
    name: "M1.3 — Prototype Alpha (TRL4)",
    date: monthStart(12),
    description: "First integrated prototype of AIWEPI sub-systems; laboratory validation of core AI inference pipeline.",
    color: "#f59e0b",
    icon: "🔬",
  },
  {
    name: "M1.4 — System Integration & Pilot Complete",
    date: monthStart(19),
    description: "All WPs integrated; pilot deployment on representative welding cell; pilot evaluation report submitted.",
    color: "#10b981",
    icon: "🔗",
  },
  {
    name: "M1.5 — TRL5 Achieved & Project Close",
    date: monthStart(24),
    description: "Technology Readiness Level 5 validated; final exploitation and dissemination report delivered.",
    color: "#ef4444",
    icon: "🏁",
  },
];

async function seed() {
  // Resolve user.
  const { data: usersData, error: usersErr } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (usersErr) throw usersErr;
  const user = usersData.users.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase()
  );
  if (!user) throw new Error(`user ${email} not found in auth.users`);
  const userId = user.id;
  console.log(`User: ${email} (${userId})`);

  // Resolve workspace.
  const { data: wsRows, error: wsErr } = await admin
    .from("workspaces")
    .select("id, name")
    .eq("name", WORKSPACE_NAME)
    .limit(1);
  if (wsErr) throw wsErr;
  if (!wsRows || wsRows.length === 0)
    throw new Error(`Workspace "${WORKSPACE_NAME}" not found. Run seed-aiwepi-team.mjs first.`);
  const workspaceId = wsRows[0].id;
  console.log(`Workspace: ${workspaceId}`);

  // Idempotency: delete existing milestone rows by name so we can re-insert cleanly.
  const milestoneNames = MILESTONE_DEFS.map((m) => m.name);
  const { error: delErr } = await admin
    .from("milestones")
    .delete()
    .eq("workspace_id", workspaceId)
    .in("name", milestoneNames);
  if (delErr) throw new Error(`DELETE milestones: ${delErr.message}`);

  // Insert milestones.
  for (const def of MILESTONE_DEFS) {
    const { data, error } = await admin
      .from("milestones")
      .insert({
        workspace_id: workspaceId,
        board_id: null,
        name: def.name,
        date: def.date,
        description: def.description,
        color: def.color,
        icon: def.icon,
        created_by: userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(`INSERT milestone "${def.name}": ${error.message}`);
    console.log(`  ✓ ${def.name} → ${data.id}`);
  }

  console.log(`\n✓ Seeded ${MILESTONE_DEFS.length} milestones for AIWEPI workspace ${workspaceId}`);
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
