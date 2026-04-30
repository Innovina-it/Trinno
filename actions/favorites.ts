"use server";
import { and, eq, sql } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { boardFavorites, recentViews } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import {
  ToggleFavoriteBoardInput,
  RecordBoardViewInput,
} from "@/lib/validation";

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

/**
 * Plan #16b-γ-C (#5) — record a board view. UPSERT keyed on
 * (user_id, board_id) so the row count stays bounded; `viewed_at` is
 * bumped to `now()` on every visit. Best-effort — callers should never
 * await this on a critical render path; any error is swallowed.
 */
export async function recordBoardViewImpl(
  token: string,
  input: { boardId: string },
): Promise<void> {
  const parsed = RecordBoardViewInput.parse(input);
  const userId = decodeSub(token);
  await dbAsUser(token, async (tx) => {
    await tx
      .insert(recentViews)
      .values({ userId, boardId: parsed.boardId })
      .onConflictDoUpdate({
        target: [recentViews.userId, recentViews.boardId],
        set: { viewedAt: sql`now()` },
      });
  });
}

export async function recordBoardView(input: { boardId: string }) {
  await requireUser();
  const t = (await getSessionToken())!;
  return recordBoardViewImpl(t, input);
}
