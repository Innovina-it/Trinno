"use server";

import { revalidatePath } from "next/cache";
import { requireUser, getSessionToken } from "@/lib/auth";
import { isImportPlanAllowed } from "@/lib/plan-import/access";
import { ProjectPlanSchema } from "@/lib/plan-import/types";
import { buildWorkspaceFromPlan } from "@/lib/plan-import/build";

// Manual mode accepts a folder link or a bare id; pull the id out of a
// .../folders/<id> URL, else use the trimmed input.
function parseDriveFolderId(raw?: string): string | undefined {
  const s = raw?.trim();
  if (!s) return undefined;
  return s.match(/\/folders\/([A-Za-z0-9_-]+)/)?.[1] ?? s;
}

// Build a new workspace from a (user-reviewed) plan. Validates the plan with the
// same Zod schema the extractor uses, then delegates to the RLS-safe builder
// under the caller's JWT. Returns the BuildResult ({ workspaceId, ok, partial,
// failures }) so the wizard can route on success or surface partial failures.
export async function buildWorkspaceFromPlanAction(input: {
  plan: unknown;
  driveMode?: "auto" | "manual" | "off";
  driveFolderId?: string;
  applyOwners?: boolean;
}) {
  const user = await requireUser();
  // Restricted feature: reject anyone off the allowlist (this action is callable
  // directly, so the page 404 alone is not enough). See lib/plan-import/access.ts.
  if (!isImportPlanAllowed(user.email)) {
    throw new Error("You don't have access to plan import.");
  }
  const token = (await getSessionToken())!;
  const plan = ProjectPlanSchema.parse(input.plan);
  const result = await buildWorkspaceFromPlan(token, plan, {
    driveMode: input.driveMode,
    manualFolderId: parseDriveFolderId(input.driveFolderId),
    applyOwners: input.applyOwners,
  });
  revalidatePath("/");
  return result;
}
