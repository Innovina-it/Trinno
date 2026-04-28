import { afterAll, describe, it, expect } from "vitest";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!);

afterAll(async () => {
  await sql.end();
});

describe("foundation schema", () => {
  it("has all foundation tables", async () => {
    const rows = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public'
        and table_name in ('profiles','workspaces','workspace_members',
                           'boards','board_members')
    `;
    expect(rows.map((r) => r.table_name).sort()).toEqual([
      "board_members",
      "boards",
      "profiles",
      "workspace_members",
      "workspaces",
    ]);
  });
});
