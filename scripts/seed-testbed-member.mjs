#!/usr/bin/env node
// Testbed seed: a second user with workspace_role = 'member' in the
// Testbed workspace. Used by TB-46 as the "guest" surrogate, because
// the workspace_role enum currently has no 'guest' value — both 'guest'
// and 'member' are denied by the board-create role gate (only owner/admin
// can create boards). This proves the "cannot create board" leg of
// the D0.3 guest matrix.
//
// To test additional guest-only behaviors (read-only on assigned-only
// boards, comment on assigned cards, etc.) a real 'guest' enum value
// must be added in a follow-up migration. See TB-46 starting state.

import {
  ensureUser,
  ensureWorkspace,
  ensureMembership,
  TESTBED_EMAIL,
  TESTBED_PASSWORD,
  TESTBED_MEMBER_EMAIL,
  TESTBED_MEMBER_PASSWORD,
} from "./seed-testbed-common.mjs";

const OUTSIDER_EMAIL = "testbed-outsider@local";
const OUTSIDER_PASSWORD = "testbed-seed-2026";

async function main() {
  const ownerId = await ensureUser(TESTBED_EMAIL, TESTBED_PASSWORD);
  const ws = await ensureWorkspace(ownerId);
  const memberId = await ensureUser(TESTBED_MEMBER_EMAIL, TESTBED_MEMBER_PASSWORD);
  await ensureMembership(ws.id, memberId, "member");
  console.log(`done — ${TESTBED_MEMBER_EMAIL} is a 'member' of workspace ${ws.id}`);
  console.log(`     login: ${TESTBED_MEMBER_EMAIL} / ${TESTBED_MEMBER_PASSWORD}`);

  // Outsider: exists but is NOT a workspace member. Used by TB-08
  // (storage RLS) and any "non-member denied" test.
  const outsiderId = await ensureUser(OUTSIDER_EMAIL, OUTSIDER_PASSWORD);
  console.log(`done — ${OUTSIDER_EMAIL} (id ${outsiderId}) is NOT a member of any workspace`);
  console.log(`     login: ${OUTSIDER_EMAIL} / ${OUTSIDER_PASSWORD}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
