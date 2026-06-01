"use server";
import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { cards, links } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import {
  UpsertCardLinkInput,
  UpsertWorkspaceLinkInput,
  RemoveCardLinkInput,
  RemoveWorkspaceLinkInput,
} from "@/lib/validation";
import { StructuredError, actionResult } from "@/lib/errors";
import { normalizeUrl } from "@/lib/links/normalize-url";
import { assertWorkspaceWriter } from "@/lib/permissions/workspace-writer";
import {
  getWorkspaceRole,
  getWorkspaceRoleForCard,
} from "@/lib/permissions/guest-guard";

function decodeSub(jwt: string): string {
  const [, payload] = jwt.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).sub;
}

export async function upsertCardLinkImpl(
  token: string,
  input: { cardId: string; url: string; color: string },
) {
  const parsed = UpsertCardLinkInput.parse(input);
  const url = normalizeUrl(parsed.url);
  const createdBy = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    assertWorkspaceWriter(
      await getWorkspaceRoleForCard(tx, parsed.cardId, createdBy),
    );
    // boardId lives on the card, not the link row (card-scope links carry
    // workspace_id, filled by the trigger). Fetch it for concrete-path
    // revalidation in the wrapper.
    const [card] = await tx
      .select({ boardId: cards.boardId })
      .from(cards)
      .where(eq(cards.id, parsed.cardId))
      .limit(1);
    const [row] = await tx
      .insert(links)
      .values({
        scope: "card",
        workspaceId: "00000000-0000-0000-0000-000000000000", // overwritten by trigger
        cardId: parsed.cardId,
        url,
        color: parsed.color,
        createdBy,
      })
      .onConflictDoUpdate({
        target: links.cardId,
        targetWhere: sql`scope = 'card'`,
        set: { url, color: parsed.color },
      })
      .returning();
    if (!row) throw new StructuredError("ACCESS_DENIED", "Forbidden");
    return { ...row, boardId: card?.boardId ?? null };
  });
}

export async function removeCardLinkImpl(
  token: string,
  input: { cardId: string },
) {
  const parsed = RemoveCardLinkInput.parse(input);
  const actor = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    assertWorkspaceWriter(
      await getWorkspaceRoleForCard(tx, parsed.cardId, actor),
    );
    const [card] = await tx
      .select({ boardId: cards.boardId })
      .from(cards)
      .where(eq(cards.id, parsed.cardId))
      .limit(1);
    const r = await tx
      .delete(links)
      .where(and(eq(links.cardId, parsed.cardId), eq(links.scope, "card")))
      .returning({ id: links.id });
    if (r.length === 0) throw new StructuredError("NOT_FOUND", "No link");
    return { boardId: card?.boardId ?? null };
  });
}

export async function upsertWorkspaceLinkImpl(
  token: string,
  input: { workspaceId: string; url: string },
) {
  const parsed = UpsertWorkspaceLinkInput.parse(input);
  const url = normalizeUrl(parsed.url);
  const createdBy = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    assertWorkspaceWriter(
      await getWorkspaceRole(tx, parsed.workspaceId, createdBy),
    );
    const [row] = await tx
      .insert(links)
      .values({
        scope: "workspace",
        workspaceId: parsed.workspaceId,
        url,
        createdBy,
      })
      .onConflictDoUpdate({
        target: links.workspaceId,
        targetWhere: sql`scope = 'workspace'`,
        set: { url },
      })
      .returning();
    if (!row) throw new StructuredError("ACCESS_DENIED", "Forbidden");
    return row;
  });
}

export async function removeWorkspaceLinkImpl(
  token: string,
  input: { workspaceId: string },
) {
  const parsed = RemoveWorkspaceLinkInput.parse(input);
  const actor = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    assertWorkspaceWriter(
      await getWorkspaceRole(tx, parsed.workspaceId, actor),
    );
    const r = await tx
      .delete(links)
      .where(
        and(
          eq(links.workspaceId, parsed.workspaceId),
          eq(links.scope, "workspace"),
        ),
      )
      .returning({ id: links.id });
    if (r.length === 0) throw new StructuredError("NOT_FOUND", "No link");
  });
}

// Wrappers. Card-scope rows carry workspace_id (filled by trigger), not
// board_id, so the impls also return the card's boardId for concrete-path
// revalidation — matching the codebase's `/b/${boardId}` convention.
export async function upsertCardLink(input: {
  cardId: string;
  url: string;
  color: string;
}) {
  return actionResult(async () => {
    await requireUser();
    const t = (await getSessionToken())!;
    const r = await upsertCardLinkImpl(t, input);
    if (r.boardId) revalidatePath(`/b/${r.boardId}`);
    if (r.workspaceId) revalidatePath(`/w/${r.workspaceId}/roadmap`);
    return r;
  });
}

export async function removeCardLink(input: { cardId: string }) {
  return actionResult(async () => {
    await requireUser();
    const t = (await getSessionToken())!;
    const r = await removeCardLinkImpl(t, input);
    if (r.boardId) revalidatePath(`/b/${r.boardId}`);
  });
}

export async function upsertWorkspaceLink(input: {
  workspaceId: string;
  url: string;
}) {
  return actionResult(async () => {
    await requireUser();
    const t = (await getSessionToken())!;
    const r = await upsertWorkspaceLinkImpl(t, input);
    revalidatePath(`/w/${r.workspaceId}`, "layout");
    return r;
  });
}

export async function removeWorkspaceLink(input: { workspaceId: string }) {
  return actionResult(async () => {
    await requireUser();
    const t = (await getSessionToken())!;
    await removeWorkspaceLinkImpl(t, input);
    revalidatePath(`/w/${input.workspaceId}`, "layout");
  });
}
