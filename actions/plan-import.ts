"use server";

import { revalidatePath } from "next/cache";
import { requireUser, getSessionToken } from "@/lib/auth";
import { ProjectPlanSchema } from "@/lib/plan-import/types";
import { buildWorkspaceFromPlan } from "@/lib/plan-import/build";

// Build a new workspace from a (user-reviewed) plan. Validates the plan with the
// same Zod schema the extractor uses, then delegates to the RLS-safe builder
// under the caller's JWT. Returns the BuildResult ({ workspaceId, ok, partial,
// failures }) so the wizard can route on success or surface partial failures.
export async function buildWorkspaceFromPlanAction(input: {
  plan: unknown;
  driveFolderId?: string;
}) {
  await requireUser();
  const token = (await getSessionToken())!;
  const plan = ProjectPlanSchema.parse(input.plan);
  const folderId = input.driveFolderId?.trim() || undefined;
  const result = await buildWorkspaceFromPlan(token, plan, folderId);
  revalidatePath("/");
  return result;
}
