"use server";
import { revalidatePath } from "next/cache";
import { eq, and, sql } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { cardVersions, cards, boards } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import {
  SetCardVersionInput,
  ClearCardVersionInput,
} from "@/lib/validation";
import { StructuredError } from "@/lib/errors";
import {
  assertNotGuest,
  getWorkspaceRoleForCard,
} from "@/lib/permissions/guest-guard";

function decodeSub(jwt: string): string {
  const [, payload] = jwt.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).sub;
}

const PLACEHOLDER_WORKSPACE_ID = "00000000-0000-0000-0000-000000000000";

export async function setCardVersionImpl(
  token: string,
  input: { cardId: string; versionId: string; kind: "affects" | "fixes" },
) {
  const p = SetCardVersionInput.parse(input);
  const actorId = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    assertNotGuest(await getWorkspaceRoleForCard(tx, p.cardId, actorId));
    // ON CONFLICT DO NOTHING — idempotent if already attached.
    const inserted = await tx
      .insert(cardVersions)
      .values({
        cardId: p.cardId,
        versionId: p.versionId,
        kind: p.kind,
        workspaceId: PLACEHOLDER_WORKSPACE_ID,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted.length === 0) {
      // Already attached — make sure the row actually exists (else RLS blocked the insert).
      const existing = await tx
        .select()
        .from(cardVersions)
        .where(
          and(
            eq(cardVersions.cardId, p.cardId),
            eq(cardVersions.versionId, p.versionId),
            sql`${cardVersions.kind} = ${p.kind}::public.card_version_kind`,
          ),
        );
      if (existing.length === 0) throw new StructuredError("ACCESS_DENIED", "Forbidden");
      return { attached: true, alreadyExisted: true, row: existing[0] };
    }
    return { attached: true, alreadyExisted: false, row: inserted[0] };
  });
}

export async function clearCardVersionImpl(
  token: string,
  input: { cardId: string; versionId: string; kind: "affects" | "fixes" },
) {
  const p = ClearCardVersionInput.parse(input);
  const actorId = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    assertNotGuest(await getWorkspaceRoleForCard(tx, p.cardId, actorId));
    await tx
      .delete(cardVersions)
      .where(
        and(
          eq(cardVersions.cardId, p.cardId),
          eq(cardVersions.versionId, p.versionId),
          sql`${cardVersions.kind} = ${p.kind}::public.card_version_kind`,
        ),
      );
    return { attached: false };
  });
}

async function lookupBoardWorkspace(
  token: string,
  cardId: string,
): Promise<{ boardId: string; workspaceId: string } | null> {
  return dbAsUser(token, async (tx) => {
    const rows = await tx
      .select({ boardId: cards.boardId, workspaceId: boards.workspaceId })
      .from(cards)
      .innerJoin(boards, eq(boards.id, cards.boardId))
      .where(eq(cards.id, cardId));
    return rows[0] ?? null;
  });
}

export async function setCardVersion(input: {
  cardId: string;
  versionId: string;
  kind: "affects" | "fixes";
}) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await setCardVersionImpl(t, input);
  const ctx = await lookupBoardWorkspace(t, input.cardId);
  if (ctx) {
    revalidatePath(`/b/${ctx.boardId}`);
    revalidatePath(`/w/${ctx.workspaceId}/versions/${input.versionId}`);
  }
  return r;
}

export async function clearCardVersion(input: {
  cardId: string;
  versionId: string;
  kind: "affects" | "fixes";
}) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await clearCardVersionImpl(t, input);
  const ctx = await lookupBoardWorkspace(t, input.cardId);
  if (ctx) {
    revalidatePath(`/b/${ctx.boardId}`);
    revalidatePath(`/w/${ctx.workspaceId}/versions/${input.versionId}`);
  }
  return r;
}
