#!/usr/bin/env node
// Testbed seed: a board named "TB-Big" with 500 cards in one list.
// Sets workspaces.feature_flags.virtualized_board = true so the
// board virtualization tests (TB-20/21/23) run flag-ON.
// To test flag-OFF (TB-22), flip the flag manually via SQL.

import {
  admin,
  ensureUser,
  ensureWorkspace,
  findOrCreateBoard,
  findOrCreateList,
  setWorkspaceFlag,
  rankString,
  TESTBED_EMAIL,
  TESTBED_PASSWORD,
} from "./seed-testbed-common.mjs";

const BOARD_TITLE = "TB-Big";
const LIST_TITLE = "Backlog";
const CARD_COUNT = 500;

async function main() {
  const userId = await ensureUser(TESTBED_EMAIL, TESTBED_PASSWORD);
  const ws = await ensureWorkspace(userId);
  await setWorkspaceFlag(ws.id, "virtualized_board", true);

  const boardId = await findOrCreateBoard(ws.id, BOARD_TITLE, userId);
  const listId = await findOrCreateList(boardId, LIST_TITLE);

  const { count: existing } = await admin
    .from("cards")
    .select("id", { count: "exact", head: true })
    .eq("board_id", boardId)
    .eq("list_id", listId);

  if ((existing ?? 0) >= CARD_COUNT) {
    console.log(`board already has ${existing} cards — skipping insert`);
    return;
  }

  const startFrom = existing ?? 0;
  const batchSize = 100;
  for (let offset = startFrom; offset < CARD_COUNT; offset += batchSize) {
    const batch = [];
    for (let i = offset; i < Math.min(offset + batchSize, CARD_COUNT); i++) {
      batch.push({
        board_id: boardId,
        list_id: listId,
        title: `TB-Big card #${i + 1}`,
        position: rankString(i + 1),
        type: "task",
      });
    }
    const { error } = await admin.from("cards").insert(batch);
    if (error) throw error;
    console.log(`inserted cards ${offset + 1}..${Math.min(offset + batchSize, CARD_COUNT)}`);
  }
  console.log(`done — board "${BOARD_TITLE}" has ${CARD_COUNT} cards in "${LIST_TITLE}"`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
