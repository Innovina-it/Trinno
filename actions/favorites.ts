"use server";
import { and, eq } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { boardFavorites } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import { ToggleFavoriteBoardInput } from "@/lib/validation";

function decodeSub(jwt: string): string {
  const [, payload] = jwt.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).sub;
}

/**
 * Plan #16b-γ-C (#4) — toggle a board favorite. If the row exists we
 * delete it; otherwise we insert. RLS already enforces that the caller
 * is the row owner AND a member of the board on insert.
 *
 * Returns `{ favorited }` so the optimistic UI can confirm the new
 * state matches what the server persisted.
 */
export async function toggleFavoriteBoardImpl(
  token: string,
  input: { boardId: string },
): Promise<{ favorited: boolean }> {
  const parsed = ToggleFavoriteBoardInput.parse(input);
  const userId = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    const existing = await tx
      .select({ boardId: boardFavorites.boardId })
      .from(boardFavorites)
      .where(
        and(
          eq(boardFavorites.userId, userId),
          eq(boardFavorites.boardId, parsed.boardId),
        ),
      );
    if (existing.length > 0) {
      await tx
        .delete(boardFavorites)
        .where(
          and(
            eq(boardFavorites.userId, userId),
            eq(boardFavorites.boardId, parsed.boardId),
          ),
        );
      return { favorited: false };
    }
    await tx
      .insert(boardFavorites)
      .values({ userId, boardId: parsed.boardId })
      .onConflictDoNothing();
    return { favorited: true };
  });
}

export async function toggleFavoriteBoard(input: { boardId: string }) {
  await requireUser();
  const t = (await getSessionToken())!;
  return toggleFavoriteBoardImpl(t, input);
}
