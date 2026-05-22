import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl, renameListImpl } from "@/actions/lists";
import {
  createSprintImpl,
  startSprintImpl,
} from "@/actions/sprints";
import { removeMemberImpl } from "@/actions/workspace-members";
import { removeBoardMemberImpl } from "@/actions/board-members";
import { StructuredError } from "@/lib/errors";

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
  return { id: data.user!.id, jwt: s.session!.access_token };
}

describe("U2 — server actions throw StructuredError with codes", () => {
  it("renameList by a non-member rejects with code ACCESS_DENIED", async () => {
    const owner = await makeUser("owner");
    const ws = await createWorkspaceImpl(owner.jwt, { name: "WS" });
    const b = await createBoardImpl(owner.jwt, {
      workspaceId: ws.id,
      title: "B",
      backgroundKind: "color",
      backgroundValue: "#fafafa",
    });
    const list = await createListImpl(owner.jwt, {
      boardId: b.id,
      title: "L",
    });

    const intruder = await makeUser("intruder");
    let caught: unknown;
    try {
      await renameListImpl(intruder.jwt, { id: list.id, title: "hacked" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(StructuredError);
    expect((caught as StructuredError).code).toBe("ACCESS_DENIED");
  });

  it("non-admin cannot manage sprints — code ROLE_INSUFFICIENT", async () => {
    const owner = await makeUser("owner2");
    const ws = await createWorkspaceImpl(owner.jwt, { name: "WS2" });

    // Add a second user as a plain "member" so they pass workspace
    // membership checks but fail the owner/admin gate.
    const member = await makeUser("member");
    await service
      .from("workspace_members")
      .insert({ workspace_id: ws.id, user_id: member.id, role: "member" });

    let caught: unknown;
    try {
      await createSprintImpl(member.jwt, {
        workspaceId: ws.id,
        name: "S1",
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(StructuredError);
    expect((caught as StructuredError).code).toBe("ROLE_INSUFFICIENT");
  });

  it("non-admin member cannot remove a workspace member — ROLE_INSUFFICIENT", async () => {
    const owner = await makeUser("owner-rm");
    const ws = await createWorkspaceImpl(owner.jwt, { name: "WS-rm" });

    // Add a plain "member" who's NOT owner/admin.
    const member = await makeUser("member-rm");
    await service
      .from("workspace_members")
      .insert({ workspaceId: ws.id, user_id: member.id, role: "member" });

    // And a 3rd user the member will try to remove (placeholder target;
    // assertion fires before any DELETE runs).
    const target = await makeUser("target-rm");
    await service
      .from("workspace_members")
      .insert({ workspaceId: ws.id, user_id: target.id, role: "admin" });

    let caught: unknown;
    try {
      await removeMemberImpl(member.jwt, {
        workspaceId: ws.id,
        userId: target.id,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(StructuredError);
    expect((caught as StructuredError).code).toBe("ROLE_INSUFFICIENT");
    expect((caught as StructuredError).message).toMatch(
      /owners and admins can manage members/i,
    );
  });

  it("non-admin member cannot remove a board member — ROLE_INSUFFICIENT", async () => {
    const owner = await makeUser("bowner");
    const ws = await createWorkspaceImpl(owner.jwt, { name: "WS-board-rm" });
    const board = await createBoardImpl(owner.jwt, {
      workspaceId: ws.id,
      title: "B",
      backgroundKind: "color",
      backgroundValue: "#fafafa",
    });

    // Add a plain workspace member (no board-admin role).
    const member = await makeUser("bmember");
    await service
      .from("workspace_members")
      .insert({ workspaceId: ws.id, user_id: member.id, role: "member" });
    // Make them a "member" on the board too (not admin).
    await service
      .from("board_members")
      .insert({ board_id: board.id, user_id: member.id, role: "member" });

    // A target board admin for them to fail to remove.
    const target = await makeUser("btarget");
    await service
      .from("workspace_members")
      .insert({ workspaceId: ws.id, user_id: target.id, role: "member" });
    await service
      .from("board_members")
      .insert({ board_id: board.id, user_id: target.id, role: "admin" });

    let caught: unknown;
    try {
      await removeBoardMemberImpl(member.jwt, {
        boardId: board.id,
        userId: target.id,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(StructuredError);
    expect((caught as StructuredError).code).toBe("ROLE_INSUFFICIENT");
    expect((caught as StructuredError).message).toMatch(
      /board admins or workspace owners\/admins/i,
    );
  });

  it("re-starting an already-active sprint rejects with code CONFLICT", async () => {
    const u = await makeUser("conflict");
    const ws = await createWorkspaceImpl(u.jwt, { name: "WS3" });
    const s = await createSprintImpl(u.jwt, {
      workspaceId: ws.id,
      name: "Sprint",
    });
    await startSprintImpl(u.jwt, { id: s.id });

    let caught: unknown;
    try {
      // Sprint is no longer in "planned" state, so the where-clause
      // filter returns 0 rows and the CONFLICT throw fires.
      await startSprintImpl(u.jwt, { id: s.id });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(StructuredError);
    expect((caught as StructuredError).code).toBe("CONFLICT");
  });
});
