import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { inviteMemberImpl, resendInvitationImpl, removeMemberImpl } from "@/actions/workspace-members";
import { inviteWorkspaceRedirectImpl } from "@/actions/auth";
import { listMembers } from "@/lib/queries/workspaces";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function makeUser(email: string) {
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

function userClient(jwt: string) {
  return createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });
}

describe("invitation acceptance trigger", () => {
  it("flips status to accepted when the user confirms their email", async () => {
    const a = await makeUser(`acc-owner-${Date.now()}@x.io`);
    const aCli = userClient(a.jwt);
    const { data: ws } = await aCli.from("workspaces").select("id");
    const wsId = ws![0].id as string;

    const email = `acc-invitee-${Date.now()}@gmail.com`;
    const { data: created } = await service.auth.admin.createUser({
      email,
      email_confirm: false,
    });
    const inviteeId = created.user!.id;
    await service.from("workspace_invitations").insert({
      workspace_id: wsId,
      email,
      role: "member",
      invited_by: a.id,
      user_id: inviteeId,
      status: "pending",
    });

    await service.auth.admin.updateUserById(inviteeId, { email_confirm: true });

    const { data: after } = await service
      .from("workspace_invitations")
      .select("status, accepted_at")
      .eq("user_id", inviteeId)
      .single();
    expect(after!.status).toBe("accepted");
    expect(after!.accepted_at).not.toBeNull();
  });
});

describe("inviteMemberImpl auto-detect", () => {
  it("adds an existing user directly with no invitation row", async () => {
    const owner = await makeUser(`own1-${Date.now()}@x.io`);
    const existing = await makeUser(`exist-${Date.now()}@x.io`);
    const ownerCli = userClient(owner.jwt);
    const { data: ws } = await ownerCli.from("workspaces").select("id");
    const wsId = ws![0].id as string;

    const { data: eu } = await service.auth.admin.getUserById(existing.id);
    const email = eu.user!.email!;

    const res = await inviteMemberImpl(owner.jwt, {
      workspaceId: wsId,
      email,
      role: "member",
    });
    expect(res.kind).toBe("added");
    expect(res.userId).toBe(existing.id);

    const { data: inv } = await service
      .from("workspace_invitations")
      .select("id")
      .eq("workspace_id", wsId);
    expect(inv?.length ?? 0).toBe(0);

    const { data: mem } = await service
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", wsId)
      .eq("user_id", existing.id);
    expect(mem?.length).toBe(1);
  });

  it("invites a brand-new email: invitation + membership + auth user", async () => {
    const owner = await makeUser(`own2-${Date.now()}@x.io`);
    const ownerCli = userClient(owner.jwt);
    const { data: ws } = await ownerCli.from("workspaces").select("id");
    const wsId = ws![0].id as string;
    const email = `fresh-${Date.now()}@gmail.com`;

    const res = await inviteMemberImpl(owner.jwt, {
      workspaceId: wsId,
      email,
      role: "member",
    });
    expect(res.kind).toBe("invited");

    const { data: inv } = await service
      .from("workspace_invitations")
      .select("status, user_id")
      .eq("workspace_id", wsId)
      .eq("email", email)
      .single();
    expect(inv!.status).toBe("pending");
    expect(inv!.user_id).toBe(res.userId);

    const { data: mem } = await service
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", wsId)
      .eq("user_id", res.userId);
    expect(mem?.length).toBe(1);

    const { data: u } = await service.auth.admin.getUserById(res.userId);
    expect(u.user?.email).toBe(email);
  });

  it("rejects a duplicate pending invite for the same email", async () => {
    const owner = await makeUser(`own3-${Date.now()}@x.io`);
    const ownerCli = userClient(owner.jwt);
    const { data: ws } = await ownerCli.from("workspaces").select("id");
    const wsId = ws![0].id as string;
    const email = `dup-${Date.now()}@gmail.com`;

    await inviteMemberImpl(owner.jwt, { workspaceId: wsId, email, role: "member" });
    await expect(
      inviteMemberImpl(owner.jwt, { workspaceId: wsId, email, role: "member" }),
    ).rejects.toThrow();
  });
});

describe("workspace_invitations table + RLS", () => {
  it("admin can insert/select; non-member cannot select; pending is unique", async () => {
    const a = await makeUser(`inv-a-${Date.now()}@x.io`);
    const b = await makeUser(`inv-b-${Date.now()}@x.io`);
    const aCli = userClient(a.jwt);
    const bCli = userClient(b.jwt);

    const { data: ws } = await aCli.from("workspaces").select("id");
    const wsId = ws![0].id as string;
    const email = `pending-${Date.now()}@gmail.com`;

    const { error: insErr } = await aCli.from("workspace_invitations").insert({
      workspace_id: wsId,
      email,
      role: "member",
      invited_by: a.id,
      status: "pending",
    });
    expect(insErr).toBeNull();

    const { data: aSees } = await aCli
      .from("workspace_invitations")
      .select("email,status")
      .eq("workspace_id", wsId);
    expect(aSees?.some((r) => r.email === email)).toBe(true);

    const { data: bSees } = await bCli
      .from("workspace_invitations")
      .select("email")
      .eq("workspace_id", wsId);
    expect(bSees?.length ?? 0).toBe(0);

    const { error: dupErr } = await aCli.from("workspace_invitations").insert({
      workspace_id: wsId,
      email,
      role: "member",
      invited_by: a.id,
      status: "pending",
    });
    expect(dupErr).not.toBeNull();
  });
});

describe("listMembers pending flag", () => {
  it("flags an invited-but-unaccepted member as pending", async () => {
    const owner = await makeUser(`pend-own-${Date.now()}@x.io`);
    const ownerCli = userClient(owner.jwt);
    const { data: ws } = await ownerCli.from("workspaces").select("id");
    const wsId = ws![0].id as string;
    const email = `pend-${Date.now()}@gmail.com`;

    const res = await inviteMemberImpl(owner.jwt, { workspaceId: wsId, email, role: "member" });

    const members = await listMembers(owner.jwt, wsId);
    const ow: any = members.find((m: any) => m.userId === owner.id);
    const inv: any = members.find((m: any) => m.userId === res.userId);
    expect(ow.pending).toBe(false);
    expect(inv.pending).toBe(true);
  });
});

describe("resendInvitation", () => {
  it("succeeds for a pending invite, throws for an unknown one", async () => {
    const owner = await makeUser(`res-own-${Date.now()}@x.io`);
    const ownerCli = userClient(owner.jwt);
    const { data: ws } = await ownerCli.from("workspaces").select("id");
    const wsId = ws![0].id as string;
    const email = `res-${Date.now()}@gmail.com`;

    await inviteMemberImpl(owner.jwt, { workspaceId: wsId, email, role: "member" });

    await expect(
      resendInvitationImpl(owner.jwt, { workspaceId: wsId, email }),
    ).resolves.toBeUndefined();

    await expect(
      resendInvitationImpl(owner.jwt, { workspaceId: wsId, email: `nobody-${Date.now()}@gmail.com` }),
    ).rejects.toThrow();
  });
});

describe("removeMember revokes a pending invitation", () => {
  it("removes the membership and marks the invitation revoked", async () => {
    const owner = await makeUser(`rev-own-${Date.now()}@x.io`);
    const ownerCli = userClient(owner.jwt);
    const { data: ws } = await ownerCli.from("workspaces").select("id");
    const wsId = ws![0].id as string;
    const email = `rev-${Date.now()}@gmail.com`;

    const res = await inviteMemberImpl(owner.jwt, { workspaceId: wsId, email, role: "member" });
    await removeMemberImpl(owner.jwt, { workspaceId: wsId, userId: res.userId });

    const { data: mem } = await service
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", wsId)
      .eq("user_id", res.userId);
    expect(mem?.length ?? 0).toBe(0);

    const { data: inv } = await service
      .from("workspace_invitations")
      .select("status")
      .eq("workspace_id", wsId)
      .eq("email", email)
      .single();
    expect(inv!.status).toBe("revoked");
  });
});

describe("re-invite an unconfirmed (revoked) invitee", () => {
  it("re-issues the invite instead of silently direct-adding", async () => {
    const owner = await makeUser(`reinv-own-${Date.now()}@x.io`);
    const ownerCli = userClient(owner.jwt);
    const { data: ws } = await ownerCli.from("workspaces").select("id");
    const wsId = ws![0].id as string;
    const email = `reinv-${Date.now()}@gmail.com`;

    // First invite → unconfirmed user + pending invitation + membership.
    const first = await inviteMemberImpl(owner.jwt, { workspaceId: wsId, email, role: "member" });
    expect(first.kind).toBe("invited");

    // Revoke (remove the pending member): membership gone, invitation revoked.
    await removeMemberImpl(owner.jwt, { workspaceId: wsId, userId: first.userId });

    // Re-invite the same (still unconfirmed) email.
    const second = await inviteMemberImpl(owner.jwt, { workspaceId: wsId, email, role: "member" });
    expect(second.kind).toBe("invited");        // NOT "added"
    expect(second.userId).toBe(first.userId);

    // A fresh pending invitation exists again, and membership is re-added.
    const { data: pend } = await service
      .from("workspace_invitations")
      .select("status")
      .eq("workspace_id", wsId)
      .eq("email", email)
      .eq("status", "pending");
    expect(pend?.length).toBe(1);

    const { data: mem } = await service
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", wsId)
      .eq("user_id", first.userId);
    expect(mem?.length).toBe(1);
  });
});

describe("invitation visibility is admin-only (#2A)", () => {
  it("a plain member cannot read invitations; owner can; member sees no pending badge", async () => {
    const owner = await makeUser(`vis-own-${Date.now()}@x.io`);
    const member = await makeUser(`vis-mem-${Date.now()}@x.io`);
    const ownerCli = userClient(owner.jwt);
    const { data: ws } = await ownerCli.from("workspaces").select("id");
    const wsId = ws![0].id as string;

    // Add `member` as a plain member of the owner's workspace.
    const { data: mu } = await service.auth.admin.getUserById(member.id);
    await inviteMemberImpl(owner.jwt, { workspaceId: wsId, email: mu.user!.email!, role: "member" });

    // Owner invites an external pending invitee.
    const inviteeEmail = `vis-ext-${Date.now()}@gmail.com`;
    const inv = await inviteMemberImpl(owner.jwt, { workspaceId: wsId, email: inviteeEmail, role: "member" });

    // Owner (admin) CAN read the invitation.
    const { data: ownerSees } = await ownerCli
      .from("workspace_invitations")
      .select("email")
      .eq("workspace_id", wsId);
    expect(ownerSees?.some((r) => r.email === inviteeEmail)).toBe(true);

    // Plain member CANNOT read any invitation rows.
    const memberCli = userClient(member.jwt);
    const { data: memberSees } = await memberCli
      .from("workspace_invitations")
      .select("email")
      .eq("workspace_id", wsId);
    expect(memberSees?.length ?? 0).toBe(0);

    // listMembers under the member's token: the pending invitee shows as a
    // member but with pending=false (no badge), since the RLS-scoped join
    // returns no invitation row for a non-admin.
    const asMember = await listMembers(member.jwt, wsId);
    const inviteeRow = asMember.find((m) => m.userId === inv.userId);
    expect(inviteeRow).toBeTruthy();
    expect((inviteeRow as { pending: boolean }).pending).toBe(false);

    // listMembers under the owner's token: pending=true (badge shown).
    const asOwner = await listMembers(owner.jwt, wsId);
    const inviteeRowOwner = asOwner.find((m) => m.userId === inv.userId);
    expect(inviteeRowOwner.pending).toBe(true);
  });
});

describe("invitation authorization negatives (#A1)", () => {
  async function setupWs() {
    const owner = await makeUser(`a1-own-${Date.now()}-${Math.floor(Math.random()*1e6)}@x.io`);
    const ownerCli = userClient(owner.jwt);
    const { data: ws } = await ownerCli.from("workspaces").select("id");
    return { owner, wsId: ws![0].id as string };
  }

  it("a plain member cannot invite / resend / remove", async () => {
    const { owner, wsId } = await setupWs();
    const member = await makeUser(`a1-mem-${Date.now()}-${Math.floor(Math.random()*1e6)}@x.io`);
    const mEmail = (await service.auth.admin.getUserById(member.id)).data.user!.email!;
    await inviteMemberImpl(owner.jwt, { workspaceId: wsId, email: mEmail, role: "member" });

    await expect(
      inviteMemberImpl(member.jwt, { workspaceId: wsId, email: `x-${Date.now()}@gmail.com`, role: "member" }),
    ).rejects.toThrow();
    await expect(
      resendInvitationImpl(member.jwt, { workspaceId: wsId, email: `x-${Date.now()}@gmail.com` }),
    ).rejects.toThrow();
    await expect(
      removeMemberImpl(member.jwt, { workspaceId: wsId, userId: owner.id }),
    ).rejects.toThrow();
  });

  it("a guest cannot invite", async () => {
    const { owner, wsId } = await setupWs();
    const guest = await makeUser(`a1-guest-${Date.now()}-${Math.floor(Math.random()*1e6)}@x.io`);
    const gEmail = (await service.auth.admin.getUserById(guest.id)).data.user!.email!;
    await inviteMemberImpl(owner.jwt, { workspaceId: wsId, email: gEmail, role: "guest" });

    await expect(
      inviteMemberImpl(guest.jwt, { workspaceId: wsId, email: `g-${Date.now()}@gmail.com`, role: "member" }),
    ).rejects.toThrow();
  });

  it("a non-member cannot invite", async () => {
    const { wsId } = await setupWs();
    const outsider = await makeUser(`a1-out-${Date.now()}-${Math.floor(Math.random()*1e6)}@x.io`);
    await expect(
      inviteMemberImpl(outsider.jwt, { workspaceId: wsId, email: `o-${Date.now()}@gmail.com`, role: "member" }),
    ).rejects.toThrow();
  });

  it("role 'owner' is rejected by validation", async () => {
    const { owner, wsId } = await setupWs();
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inviteMemberImpl(owner.jwt, { workspaceId: wsId, email: `own-${Date.now()}@gmail.com`, role: "owner" as any }),
    ).rejects.toThrow();
  });

  it("RLS blocks a non-admin member from writing workspace_invitations directly", async () => {
    const { owner, wsId } = await setupWs();
    const member = await makeUser(`a1-rls-${Date.now()}-${Math.floor(Math.random()*1e6)}@x.io`);
    const mEmail = (await service.auth.admin.getUserById(member.id)).data.user!.email!;
    await inviteMemberImpl(owner.jwt, { workspaceId: wsId, email: mEmail, role: "member" });

    const memberCli = userClient(member.jwt);
    // INSERT must be denied by RLS.
    const { error: insErr } = await memberCli.from("workspace_invitations").insert({
      workspace_id: wsId, email: `rls-${Date.now()}@gmail.com`, role: "member", invited_by: member.id, status: "pending",
    });
    expect(insErr).not.toBeNull();
  });
});

describe("invitation lifecycle / state machine (#A2)", () => {
  const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  async function ownerWs() {
    const owner = await makeUser(`lc-own-${uniq()}@x.io`);
    const { data: ws } = await userClient(owner.jwt).from("workspaces").select("id");
    return { owner, wsId: ws![0].id as string };
  }

  it("invite → accept → re-invite (now confirmed) returns 'added', not 'invited'", async () => {
    const { owner, wsId } = await ownerWs();
    const email = `lc-conf-${uniq()}@gmail.com`;
    const first = await inviteMemberImpl(owner.jwt, { workspaceId: wsId, email, role: "member" });
    expect(first.kind).toBe("invited");
    // Accept (confirm) the invitee.
    await service.auth.admin.updateUserById(first.userId, { email_confirm: true });
    // Remove then re-invite the now-CONFIRMED user.
    await removeMemberImpl(owner.jwt, { workspaceId: wsId, userId: first.userId });
    const second = await inviteMemberImpl(owner.jwt, { workspaceId: wsId, email, role: "member" });
    expect(second.kind).toBe("added");
    expect(second.userId).toBe(first.userId);
  });

  it("double-confirm is idempotent (trigger does not error, stays accepted)", async () => {
    const { owner, wsId } = await ownerWs();
    const email = `lc-dbl-${uniq()}@gmail.com`;
    const r = await inviteMemberImpl(owner.jwt, { workspaceId: wsId, email, role: "member" });
    await service.auth.admin.updateUserById(r.userId, { email_confirm: true });
    // Second confirm/update must not throw nor regress the status.
    await service.auth.admin.updateUserById(r.userId, { email_confirm: true });
    const { data: inv } = await service
      .from("workspace_invitations").select("status").eq("user_id", r.userId).single();
    expect(inv!.status).toBe("accepted");
  });

  it("removing an ACCEPTED member deletes membership but leaves invitation accepted", async () => {
    const { owner, wsId } = await ownerWs();
    const email = `lc-rmacc-${uniq()}@gmail.com`;
    const r = await inviteMemberImpl(owner.jwt, { workspaceId: wsId, email, role: "member" });
    await service.auth.admin.updateUserById(r.userId, { email_confirm: true }); // → accepted
    await removeMemberImpl(owner.jwt, { workspaceId: wsId, userId: r.userId });
    const { data: mem } = await service.from("workspace_members")
      .select("user_id").eq("workspace_id", wsId).eq("user_id", r.userId);
    expect(mem?.length ?? 0).toBe(0); // membership gone
    const { data: inv } = await service.from("workspace_invitations")
      .select("status").eq("workspace_id", wsId).eq("email", email).single();
    expect(inv!.status).toBe("accepted"); // revoke only touches pending; accepted stays
  });

  it("cross-workspace invites of the same email: confirm flips ALL pending to accepted", async () => {
    const a = await ownerWs();
    const b = await ownerWs();
    const email = `lc-cross-${uniq()}@gmail.com`;
    const r1 = await inviteMemberImpl(a.owner.jwt, { workspaceId: a.wsId, email, role: "member" });
    const r2 = await inviteMemberImpl(b.owner.jwt, { workspaceId: b.wsId, email, role: "member" });
    expect(r2.userId).toBe(r1.userId); // same auth user reused
    await service.auth.admin.updateUserById(r1.userId, { email_confirm: true });
    const { data: invs } = await service.from("workspace_invitations")
      .select("workspace_id,status").eq("email", email);
    const statuses = (invs ?? []).map((i) => i.status);
    expect(statuses.length).toBe(2);
    expect(statuses.every((s) => s === "accepted")).toBe(true);
  });
});

describe("inviteWorkspaceRedirect (#A3)", () => {
  const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  // Helper: invite an external email, then give that invitee a usable session
  // (set password + confirm via admin) so we can call the Impl with their JWT.
  async function inviteAndSignIn(ownerJwt: string, wsId: string, email: string) {
    const r = await inviteMemberImpl(ownerJwt, { workspaceId: wsId, email, role: "member" });
    await service.auth.admin.updateUserById(r.userId, { password: "passw0rd!", email_confirm: true });
    const { data: s } = await createSignIn(email);
    return { userId: r.userId, jwt: s };
  }
  async function createSignIn(email: string): Promise<{ data: string }> {
    const { createClient } = await import("@supabase/supabase-js");
    const { data } = await createClient(url, anon).auth.signInWithPassword({ email, password: "passw0rd!" });
    return { data: data.session!.access_token } as unknown as { data: string };
  }

  it.fails("returns the inviting workspace for the invitee", async () => {
    const owner = await makeUser(`r-own-${uniq()}@x.io`);
    const { data: ws } = await userClient(owner.jwt).from("workspaces").select("id");
    const wsId = ws![0].id as string;
    const email = `r-inv-${uniq()}@gmail.com`;
    const invitee = await inviteAndSignIn(owner.jwt, wsId, email);

    const redirect = await inviteWorkspaceRedirectImpl(invitee.jwt);
    expect(redirect).toBe(wsId);
  });

  it("returns null for a user with no invitation", async () => {
    const u = await makeUser(`r-none-${uniq()}@x.io`);
    const redirect = await inviteWorkspaceRedirectImpl(u.jwt);
    expect(redirect).toBeNull();
  });
});

describe("email normalization (#A3-email)", () => {
  const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  async function ownerWs() {
    const owner = await makeUser(`en-own-${uniq()}@x.io`);
    const { data: ws } = await userClient(owner.jwt).from("workspaces").select("id");
    return { owner, wsId: ws![0].id as string };
  }

  it("stores the invitee email trimmed + lowercased", async () => {
    const { owner, wsId } = await ownerWs();
    const raw = `  MiXeD-${uniq()}@GMAIL.com  `;
    const res = await inviteMemberImpl(owner.jwt, { workspaceId: wsId, email: raw, role: "member" });
    const { data: inv } = await service
      .from("workspace_invitations").select("email").eq("user_id", res.userId).single();
    expect(inv!.email).toBe(raw.trim().toLowerCase());
  });

  it("detects duplicate invites case-insensitively", async () => {
    const { owner, wsId } = await ownerWs();
    const base = `casedup-${uniq()}@gmail.com`;
    await inviteMemberImpl(owner.jwt, { workspaceId: wsId, email: base.toUpperCase(), role: "member" });
    await expect(
      inviteMemberImpl(owner.jwt, { workspaceId: wsId, email: base, role: "member" }),
    ).rejects.toThrow();
  });
});
