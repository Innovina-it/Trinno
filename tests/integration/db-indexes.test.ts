import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

type PlanRow = { "QUERY PLAN": string };

afterAll(async () => {
  await sql.end();
});

describe("database hot-path indexes", () => {
  it("uses the unread notification partial index for inbox reads", async () => {
    const runId = `idx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const recipientId = randomUUID();
    const otherRecipientId = randomUUID();

    /*
      Target SQL:

        select id, created_at
        from public.notifications
        where recipient_user_id = '<recipient-id>'::uuid
          and read_at is null
        order by read_at asc, created_at desc
        limit 50;

      Representative EXPLAIN (ANALYZE, BUFFERS) after 0101:

        Limit
          ->  Index Scan using notifications_recipient_read_at_unread_created_idx on notifications
                Index Cond: ((recipient_user_id = '<recipient-id>'::uuid) AND (read_at IS NULL))
        Planning Time: 0.221 ms
        Execution Time: 0.148 ms
    */

    try {
      await sql`set session_replication_role = replica`;
      await sql`
        insert into public.notifications (
          recipient_user_id,
          kind,
          payload,
          read_at,
          created_at
        )
        select
          ${recipientId}::uuid,
          'card.assigned',
          jsonb_build_object('index_test_run', ${runId}::text),
          null,
          now() - (n || ' seconds')::interval
        from generate_series(1, 1000) as n
      `;
      await sql`
        insert into public.notifications (
          recipient_user_id,
          kind,
          payload,
          read_at,
          created_at
        )
        select
          ${recipientId}::uuid,
          'card.assigned',
          jsonb_build_object('index_test_run', ${runId}::text),
          now(),
          now() + (n || ' seconds')::interval
        from generate_series(1, 4000) as n
      `;
      await sql`
        insert into public.notifications (
          recipient_user_id,
          kind,
          payload,
          read_at,
          created_at
        )
        select
          ${otherRecipientId}::uuid,
          'card.assigned',
          jsonb_build_object('index_test_run', ${runId}::text),
          null,
          now() - (n || ' seconds')::interval
        from generate_series(1, 1000) as n
      `;
      await sql`set session_replication_role = origin`;
      await sql`analyze public.notifications`;

      const indexRows = await sql<{ indexname: string }[]>`
        select indexname
        from pg_indexes
        where schemaname = 'public'
          and tablename = 'notifications'
          and indexname = 'notifications_recipient_read_at_unread_created_idx'
      `;
      expect(indexRows).toHaveLength(1);

      const planRows = await sql<PlanRow[]>`
        explain (analyze, buffers, format text)
        select id, created_at
        from public.notifications
        where recipient_user_id = ${recipientId}::uuid
          and read_at is null
        order by read_at asc, created_at desc
        limit 50
      `;
      const plan = planRows.map((row) => row["QUERY PLAN"]).join("\n");
      const executionMs = Number(
        plan.match(/Execution Time: ([0-9.]+) ms/)?.[1] ?? Number.POSITIVE_INFINITY,
      );

      expect(plan).toContain("notifications_recipient_read_at_unread_created_idx");
      expect(executionMs).toBeLessThan(50);
    } finally {
      await sql`set session_replication_role = origin`;
      await sql`
        delete from public.notifications
        where payload ->> 'index_test_run' = ${runId}
      `;
      await sql`analyze public.notifications`;
    }
  });
});
