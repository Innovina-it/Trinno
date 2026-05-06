"use server";
import { sql } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { profiles } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import { eq } from "drizzle-orm";

// Used by the invite forms to preview the matched profile before the
// admin commits the invite ("Did you mean Bob Smith / @bsmith?").
// `find_user_id_by_email` is SECURITY DEFINER so this works for any
// authenticated user; the subsequent profile read is RLS-bound — if
// the caller can't see the profile (no shared workspace yet) we fall
// back to confirming only that the email exists.
export async function lookupProfileByEmail(
  emailRaw: string,
): Promise<
  | { kind: "found"; id: string; displayName: string; handle: string | null }
  | { kind: "exists"; id: string }
  | { kind: "missing" }
> {
  await requireUser();
  const t = (await getSessionToken())!;
  const email = emailRaw.trim().toLowerCase();
  if (!email || !email.includes("@")) return { kind: "missing" };
  return dbAsUser(t, async (tx) => {
    const lookup = await tx.execute(
      sql`select public.find_user_id_by_email(${email}) as id`,
    );
    const userId = (lookup as unknown as { id: string | null }[])[0]?.id;
    if (!userId) return { kind: "missing" };
    const [row] = await tx
      .select({
        id: profiles.id,
        displayName: profiles.displayName,
        handle: profiles.handle,
      })
      .from(profiles)
      .where(eq(profiles.id, userId));
    if (!row) return { kind: "exists", id: userId };
    return {
      kind: "found",
      id: row.id,
      displayName: row.displayName,
      handle: row.handle,
    };
  });
}
