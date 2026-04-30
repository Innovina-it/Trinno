import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { cardWatchers } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl } from "@/actions/lists";
import { createCardImpl, archiveCardImpl } from "@/actions/cards";
import { createCommentImpl } from "@/actions/comments";
import { toggleCardMemberImpl } from "@/actions/card-members";
import { inviteMemberImpl } from "@/actions/workspace-members";
import { listNotifications, unreadCount } from "@/lib/queries/notifications";
import { markNotificationReadImpl } from "@/actions/notifications";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

// Per-process unique suffix so display names don't collide across runs/files
// when the local DB hasn't been reset (the mention trigger uses
// "select id from profiles where lower(display_name) = handle limit 1" so
// stale rows from previous runs would resolve to the wrong user).
const RUN_TAG = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function makeUser(p: string, displayName?: string) {
  const email = `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@x.io`;
  const { data } = await service.auth.admin.createUser({
    email,
    password: "passw0rd!",
    email_confirm: true,
  });
  // displayName is auto-derived from email-local-part by signup trigger;
  // override if provided so @mentions tests are deterministic.
  if (displayName) {
    await service
      .from("profiles")
      .update({ display_name: displayName })
      .eq("id", data.user!.id);
  }
  const { data: s } = await createClient(url, anon).auth.signInWithPassword({
    email,
    password: "passw0rd!",
  });
  return { id: data.user!.id, jwt: s.session!.access_token, email };
}

const HANDLES = {
  alice: `alice-${RUN_TAG}`,
  owner: `owner-${RUN_TAG}`,
  watcher: `watcher-${RUN_TAG}`,
  isoA: `iso-a-${RUN_TAG}`,
  isoB: `iso-b-${RUN_TAG}`,
  guest: `guesthandle-${RUN_TAG}`,
};

async function setup(jwt: string) {
  const ws = await createWorkspaceImpl(jwt, { name: "WS" });
  const b = await createBoardImpl(jwt, {
    workspaceId: ws.id,
    title: "B",
    backgroundKind: "color",
    backgroundValue: "#fafafa",
  });
  const l = await createListImpl(jwt, { boardId: b.id, title: "L" });
  return { ws, b, l };
}

describe("notifications", () => {
  it("@mention creates a comment.mention notification + auto-watch", async () => {
    const owner = await makeUser("nm-o");
    const guest = await makeUser("nm-g", HANDLES.alice);
    const { ws, l } = await setup(owner.jwt);
    await inviteMemberImpl(owner.jwt, {
      workspaceId: ws.id,
      email: guest.email,
      role: "member",
    });
    const c = await createCardImpl(owner.jwt, { listId: l.id, title: "C" });
    await createCommentImpl(owner.jwt, {
      cardId: c.id,
      body: `Hey @${HANDLES.alice} please review`,
    });

    // alice should have a comment.mention notification.
    const aliceRows = await listNotifications(guest.jwt, { limit: 10 });
    expect(aliceRows.some((r) => r.kind === "comment.mention")).toBe(true);

    // and alice is now an auto-watcher.
    const watchers = await dbAsUser(owner.jwt, async (tx) =>
      tx.select().from(cardWatchers).where(eq(cardWatchers.cardId, c.id)),
    );
    expect(watchers.some((w) => w.userId === guest.id)).toBe(true);
  });

  it("commenter is auto-watched and gets future notifications", async () => {
    const owner = await makeUser("nw-o");
    const { l } = await setup(owner.jwt);
    const c = await createCardImpl(owner.jwt, { listId: l.id, title: "C" });
    await createCommentImpl(owner.jwt, { cardId: c.id, body: "first" });
    const watchers = await dbAsUser(owner.jwt, async (tx) =>
      tx
        .select()
        .from(cardWatchers)
        .where(
          and(
            eq(cardWatchers.cardId, c.id),
            eq(cardWatchers.userId, owner.id),
          ),
        ),
    );
    expect(watchers.length).toBe(1);
    // Self-actions don't notify (emit_notification skips actor==recipient)
  });

  it("assigning a card creates card.assigned notification", async () => {
    const owner = await makeUser("na-o");
    const guest = await makeUser("na-g");
    const { ws, l } = await setup(owner.jwt);
    await inviteMemberImpl(owner.jwt, {
      workspaceId: ws.id,
      email: guest.email,
      role: "member",
    });
    const c = await createCardImpl(owner.jwt, { listId: l.id, title: "C" });
    await toggleCardMemberImpl(owner.jwt, {
      cardId: c.id,
      userId: guest.id,
    });

    const guestRows = await listNotifications(guest.jwt, { limit: 10 });
    expect(guestRows.some((r) => r.kind === "card.assigned")).toBe(true);
  });

  it("watcher gets card.archived notification when other user archives", async () => {
    const owner = await makeUser("nx-o", HANDLES.owner);
    const guest = await makeUser("nx-g", HANDLES.watcher);
    const { ws, l } = await setup(owner.jwt);
    await inviteMemberImpl(owner.jwt, {
      workspaceId: ws.id,
      email: guest.email,
      role: "member",
    });
    const c = await createCardImpl(owner.jwt, { listId: l.id, title: "C" });
    // guest must become a board member to add a watcher; for v1 the
    // workspace-owner→board-admin RLS gives them no easy add path.
    // Direct DB watch via service role (test scaffolding):
    await service.from("card_watchers").insert({
      card_id: c.id,
      user_id: guest.id,
      board_id: c.boardId,
      auto: false,
    });
    await archiveCardImpl(owner.jwt, { id: c.id, archived: true });
    const guestRows = await listNotifications(guest.jwt, { limit: 10 });
    expect(guestRows.some((r) => r.kind === "card.archived")).toBe(true);
  });

  it("recipient cannot see other users' notifications", async () => {
    const a = await makeUser("ni-a", HANDLES.isoA);
    const b = await makeUser("ni-b", HANDLES.isoB);
    const { ws, l } = await setup(a.jwt);
    await inviteMemberImpl(a.jwt, {
      workspaceId: ws.id,
      email: b.email,
      role: "member",
    });
    const c = await createCardImpl(a.jwt, { listId: l.id, title: "C" });
    await createCommentImpl(a.jwt, { cardId: c.id, body: `@${HANDLES.isoB} test` });
    const aRows = await listNotifications(a.jwt, { limit: 10 });
    // a does not see b's mention notification
    expect(aRows.every((r) => r.kind !== "comment.mention")).toBe(true);
  });

  it("markNotificationRead sets readAt; unreadCount drops", async () => {
    const owner = await makeUser("nr-o");
    const guest = await makeUser("nr-g", HANDLES.guest);
    const { ws, l } = await setup(owner.jwt);
    await inviteMemberImpl(owner.jwt, {
      workspaceId: ws.id,
      email: guest.email,
      role: "member",
    });
    const c = await createCardImpl(owner.jwt, { listId: l.id, title: "C" });
    await createCommentImpl(owner.jwt, {
      cardId: c.id,
      body: `@${HANDLES.guest} hi`,
    });

    const before = await unreadCount(guest.jwt);
    expect(before).toBeGreaterThan(0);
    const list = await listNotifications(guest.jwt, { limit: 1 });
    await markNotificationReadImpl(guest.jwt, {
      id: list[0].id,
      read: true,
    });
    const after = await unreadCount(guest.jwt);
    expect(after).toBe(before - 1);
  });
});
