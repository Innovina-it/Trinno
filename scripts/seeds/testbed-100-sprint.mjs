#!/usr/bin/env node
// Testbed seed: a sprint with 100 cards.
// Cards sit on a board "TB-Sprint" and are bound to a sprint via
// cards.sprint_id. Used by TB-18 (bulk archive 100 cards) and
// TB-19 (sprint date shift 100 cards).

import {
  admin,
  ensureUser,
  ensureWorkspace,
  findOrCreateBoard,
  findOrCreateList,
  rankString,
  TESTBED_EMAIL,
  TESTBED_PASSWORD,
} from "./testbed-common.mjs";

const BOARD_TITLE = "TB-Sprint";
const LIST_TITLE = "In Progress";
const SPRINT_NAME = "TB-Sprint-100";
const CARD_COUNT = 100;

async function ensureSprint(workspaceId, name, startDate, endDate) {
  const { data: existing } = await admin
    .from("sprints")
    .select("id, start_date, end_date")
    .eq("workspace_id", workspaceId)
    .eq("name", name)
    .maybeSingle();
  if (existing) return existing.id;
  const { data, error } = await admin
    .from("sprints")
    .insert({
      workspace_id: workspaceId,
      name,
      start_date: startDate.toISOString(),
      end_date: endDate.toISOString(),
      state: "active",
    })
    .select("id")
    .single();
  if (error) throw error;
  console.log(`created sprint "${name}"`);
  return data.id;
}

async function main() {
  const userId = await ensureUser(TESTBED_EMAIL, TESTBED_PASSWORD);
  const ws = await ensureWorkspace(userId);
  const boardId = await findOrCreateBoard(ws.id, BOARD_TITLE, userId);
  const listId = await findOrCreateList(boardId, LIST_TITLE);

  const today = new Date();
  const inTwoWeeks = new Date(today.getTime() + 14 * 86_400_000);
  const sprintId = await ensureSprint(ws.id, SPRINT_NAME, today, inTwoWeeks);

  const { count: existing } = await admin
    .from("cards")
    .select("id", { count: "exact", head: true })
    .eq("board_id", boardId)
    .eq("sprint_id", sprintId);

  if ((existing ?? 0) >= CARD_COUNT) {
    console.log(`sprint already has ${existing} cards — skipping`);
    return;
  }

  const start = existing ?? 0;
  const batch = [];
  for (let i = start; i < CARD_COUNT; i++) {
    batch.push({
      board_id: boardId,
      list_id: listId,
      sprint_id: sprintId,
      title: `TB-Sprint card #${i + 1}`,
      position: rankString(i + 1),
      type: "task",
      start_date: today.toISOString(),
      due_date: inTwoWeeks.toISOString(),
    });
  }
  // insert in chunks of 100 (one shot is fine)
  const { error } = await admin.from("cards").insert(batch);
  if (error) throw error;
  console.log(`inserted ${batch.length} cards into sprint "${SPRINT_NAME}"`);
  console.log(`done — sprint "${SPRINT_NAME}" has ${CARD_COUNT} cards on board "${BOARD_TITLE}"`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
