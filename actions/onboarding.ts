"use server";
import { eq } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { profiles } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import { MarkOnboardingCompletedInput } from "@/lib/validation";

function decodeSub(jwt: string): string {
  const [, payload] = jwt.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).sub;
}

/**
 * Plan #16b-γ-B (#7) — flips `profiles.onboarding_completed_at` to now()
 * for the caller. RLS on profiles already restricts UPDATE to id =
 * auth.uid(), so the explicit `where id = sub` is belt-and-suspenders.
 */
export async function markOnboardingCompletedImpl(
  token: string,
  input: Record<string, never> = {},
) {
  MarkOnboardingCompletedInput.parse(input);
  const userId = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx
      .update(profiles)
      .set({ onboardingCompletedAt: new Date() })
      .where(eq(profiles.id, userId))
      .returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function markOnboardingCompleted() {
  await requireUser();
  const t = (await getSessionToken())!;
  return markOnboardingCompletedImpl(t, {});
}
