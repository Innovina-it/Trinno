import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { cardVersions, versions } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl } from "@/actions/lists";
import { createCardImpl } from "@/actions/cards";
import { inviteMemberImpl } from "@/actions/workspace-members";
import {
  createVersionImpl,
  updateVersionImpl,
} from "@/actions/versions";
import {
  setCardVersionImpl,
  clearCardVersionImpl,
} from "@/actions/card-versions";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function makeUser(p: string) {
  const email = `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@x.io`;
  const { data } = await service.auth.admin.createUser({
    email,
    password: "passw0rd!",
    email_confirm: true,
  });
  const { data: s } = await createClient(url, anon).auth.signInWithPassword({
    email,
    password: "passw0rd!",
  });
  return { id: data.user!.id, email, jwt: s.session!.access_token };
}

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

describe("versions + card_versions", () => {
  it("create + transition to released auto-fills releaseDate", async () => {
    const u = await makeUser("vr1");
    const { ws } = await setup(u.jwt);
    const v = await createVersionImpl(u.jwt, {
      workspaceId: ws.id,
      name: "v1.0.0",
    });
    expect(v.state).toBe("unreleased");
    expect(v.releaseDate).toBeNull();

    const released = await updateVersionImpl(u.jwt, {
      id: v.id,
      state: "released",
    });
    expect(released.state).toBe("released");
    expect(released.releaseDate).not.toBeNull();
  });

  it("attach affects + fixes — both rows exist with correct kind", async () => {
    const u = await makeUser("vr2");
    const { ws, l } = await setup(u.jwt);
    const v = await createVersionImpl(u.jwt, {
      workspaceId: ws.id,
      name: "v1.1",
    });
    const c = await createCardImpl(u.jwt, { listId: l.id, title: "Bug" });

    await setCardVersionImpl(u.jwt, {
      cardId: c.id,
      versionId: v.id,
      kind: "affects",
    });
    await setCardVersionImpl(u.jwt, {
      cardId: c.id,
      versionId: v.id,
      kind: "fixes",
    });

    const rows = await dbAsUser(u.jwt, async (tx) =>
      tx
        .select()
        .from(cardVersions)
        .where(
          and(
            eq(cardVersions.cardId, c.id),
            eq(cardVersions.versionId, v.id),
          ),
        ),
    );
    expect(rows.length).toBe(2);
    const kinds = rows.map((r) => r.kind).sort();
    expect(kinds).toEqual(["affects", "fixes"]);
    // Workspace denorm propagated by trigger.
    expect(rows.every((r) => r.workspaceId === ws.id)).toBe(true);

    // clear is idempotent and removes only the targeted kind.
    await clearCardVersionImpl(u.jwt, {
      cardId: c.id,
      versionId: v.id,
      kind: "affects",
    });
    const remaining = await dbAsUser(u.jwt, async (tx) =>
      tx
        .select()
        .from(cardVersions)
        .where(
          and(
            eq(cardVersions.cardId, c.id),
            eq(cardVersions.versionId, v.id),
          ),
        ),
    );
    expect(remaining.length).toBe(1);
    expect(remaining[0].kind).toBe("fixes");
  });

  it("releaseDate is preserved when transitioning back to unreleased", async () => {
    const u = await makeUser("vr3");
    const { ws } = await setup(u.jwt);
    const v = await createVersionImpl(u.jwt, {
      workspaceId: ws.id,
      name: "v1.2",
    });
    const released = await updateVersionImpl(u.jwt, {
      id: v.id,
      state: "released",
    });
    const original = released.releaseDate;
    expect(original).not.toBeNull();

    const reverted = await updateVersionImpl(u.jwt, {
      id: v.id,
      state: "unreleased",
    });
    expect(reverted.state).toBe("unreleased");
    // We don't auto-clear; the date stays put.
    expect(reverted.releaseDate).not.toBeNull();
    if (original && reverted.releaseDate) {
      expect(new Date(reverted.releaseDate).getTime()).toBe(
        new Date(original).getTime(),
      );
    }
  });

  it("non-admin workspace member cannot create a version", async () => {
    const owner = await makeUser("vr4o");
    const guest = await makeUser("vr4g");
    const { ws } = await setup(owner.jwt);

    // Owner invites guest as a regular member.
    await inviteMemberImpl(owner.jwt, {
      workspaceId: ws.id,
      email: guest.email,
      role: "member",
    });

    // Sanity: guest can read versions table for the workspace.
    const _initial = await dbAsUser(guest.jwt, async (tx) =>
      tx.select().from(versions).where(eq(versions.workspaceId, ws.id)),
    );
    expect(_initial.length).toBe(0);

    await expect(
      createVersionImpl(guest.jwt, {
        workspaceId: ws.id,
        name: "v0.0",
      }),
    ).rejects.toThrow();
  });

  it("user in workspace A cannot attach version-A to a card in workspace B", async () => {
    const ownerA = await makeUser("vr5a");
    const ownerB = await makeUser("vr5b");
    const { ws: wsA } = await setup(ownerA.jwt);
    const { l: listB } = await setup(ownerB.jwt);

    const versionA = await createVersionImpl(ownerA.jwt, {
      workspaceId: wsA.id,
      name: "vA",
    });
    const cardB = await createCardImpl(ownerB.jwt, {
      listId: listB.id,
      title: "Foreign",
    });

    // ownerA tries to attach their version to a card in workspace B.
    await expect(
      setCardVersionImpl(ownerA.jwt, {
        cardId: cardB.id,
        versionId: versionA.id,
        kind: "fixes",
      }),
    ).rejects.toThrow();

    // Verify nothing landed.
    const r = await dbAsUser(ownerA.jwt, async (tx) =>
      tx
        .select()
        .from(cardVersions)
        .where(
          and(
            eq(cardVersions.versionId, versionA.id),
            sql`${cardVersions.kind} = 'fixes'::public.card_version_kind`,
          ),
        ),
    );
    expect(r.length).toBe(0);
  });
});
