#!/usr/bin/env node
// Testbed seed: 5000 unread notifications for the testbed user.
// Used by TB-17 (unread-inbox latency surrogate).
// All rows have read_at IS NULL so the partial index is exercised.

import {
  admin,
  ensureUser,
  TESTBED_EMAIL,
  TESTBED_PASSWORD,
} from "./seed-testbed-common.mjs";

const TARGET = 5000;
const KIND = "card.assigned";

async function main() {
  const userId = await ensureUser(TESTBED_EMAIL, TESTBED_PASSWORD);

  const { count: existing } = await admin
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("recipient_user_id", userId)
    .is("read_at", null);

  if ((existing ?? 0) >= TARGET) {
    console.log(`user already has ${existing} unread — skipping`);
    return;
  }

  const start = existing ?? 0;
  const batchSize = 500;
  const tag = `tb-${Date.now()}`;
  for (let offset = start; offset < TARGET; offset += batchSize) {
    const batch = [];
    const upper = Math.min(offset + batchSize, TARGET);
    for (let i = offset; i < upper; i++) {
      batch.push({
        recipient_user_id: userId,
        kind: KIND,
        payload: { testbed: tag, seq: i + 1 },
        read_at: null,
      });
    }
    const { error } = await admin.from("notifications").insert(batch);
    if (error) throw error;
    console.log(`inserted notifications ${offset + 1}..${upper}`);
  }
  console.log(`done — user ${TESTBED_EMAIL} has ≥${TARGET} unread notifications`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
