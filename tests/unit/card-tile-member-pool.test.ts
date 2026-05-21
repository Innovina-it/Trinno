import { describe, it, expect } from "vitest";
import { mergeMemberPool } from "@/components/board/card/member-pool";
import type { BoardProfile } from "@/lib/queries/board-snapshot";

// Locks in the picker pool the board card quick view feeds into
// AssigneePicker. Order = board members first, workspace-only second.
// A freshly-added workspace member (e.g. Paolo Pavani in workspace W,
// not yet board_member(B)) must appear so they can be assigned to an
// already-existing card on B — server-side trigger 0098 then promotes
// them to board_member on assignment.

function profile(id: string, displayName: string): BoardProfile {
  return { id, displayName, handle: id, avatarUrl: null };
}

describe("mergeMemberPool", () => {
  it("orders board members first, then workspace-only members", () => {
    const board = [profile("u1", "Alice"), profile("u2", "Bob")];
    const workspace = [
      profile("u1", "Alice"),
      profile("u2", "Bob"),
      profile("u3", "Paolo Pavani"),
    ];
    const pool = mergeMemberPool(board, workspace);
    expect(pool.map((p) => p.id)).toEqual(["u1", "u2", "u3"]);
  });

  it("never duplicates a member who is both board and workspace", () => {
    const board = [profile("u1", "Alice")];
    const workspace = [profile("u1", "Alice"), profile("u2", "Bob")];
    const pool = mergeMemberPool(board, workspace);
    expect(pool).toHaveLength(2);
    expect(pool.filter((p) => p.id === "u1")).toHaveLength(1);
  });

  it("returns just board members when workspace adds nothing new", () => {
    const board = [profile("u1", "Alice"), profile("u2", "Bob")];
    const workspace = [profile("u1", "Alice"), profile("u2", "Bob")];
    const pool = mergeMemberPool(board, workspace);
    expect(pool.map((p) => p.id)).toEqual(["u1", "u2"]);
  });

  it("returns just workspace members when board list is empty", () => {
    const board: BoardProfile[] = [];
    const workspace = [profile("u3", "Paolo Pavani")];
    const pool = mergeMemberPool(board, workspace);
    expect(pool.map((p) => p.id)).toEqual(["u3"]);
  });

  it("exposes a workspace-only assignee so their name resolves on the chip", () => {
    const board = [profile("u1", "Alice")];
    const workspace = [profile("u1", "Alice"), profile("u3", "Paolo Pavani")];
    const pool = mergeMemberPool(board, workspace);
    const assignedId = "u3";
    const resolved = pool.find((p) => p.id === assignedId);
    expect(resolved?.displayName).toBe("Paolo Pavani");
  });
});
