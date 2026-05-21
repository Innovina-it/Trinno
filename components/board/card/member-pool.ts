import type { BoardProfile } from "@/lib/queries/board-snapshot";

// Picker pool = board members first, then workspace-only members
// (i.e. workspace members who are not yet board_members). Mirrors the
// merge order in card/members-section.tsx so the two card-detail
// surfaces stay consistent. Server-side trigger 0098 promotes a
// workspace-only assignee to board_member; the caller mirrors that
// optimistically.
export function mergeMemberPool(
  boardProfiles: readonly BoardProfile[],
  workspaceProfiles: readonly BoardProfile[],
): BoardProfile[] {
  const boardIds = new Set(boardProfiles.map((p) => p.id));
  const extras = workspaceProfiles.filter((p) => !boardIds.has(p.id));
  if (extras.length === 0) return boardProfiles.slice();
  return [...boardProfiles, ...extras];
}
