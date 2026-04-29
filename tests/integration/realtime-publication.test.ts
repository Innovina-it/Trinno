import { describe, it, expect, afterAll } from "vitest";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!);
afterAll(async () => { await sql.end(); });

describe("supabase_realtime publication", () => {
  it("includes lists and cards", async () => {
    const rows = await sql<{ tablename: string }[]>`
      select tablename from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename in ('lists','cards')
    `;
    expect(rows.map(r => r.tablename).sort()).toEqual(["cards", "lists"]);
  });
});
