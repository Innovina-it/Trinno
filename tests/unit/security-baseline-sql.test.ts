import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const authMigration = join(
  root,
  "supabase/migrations/0056_auth_domain_allowlist.sql",
);
const storageMigration = join(root, "supabase/migrations/0057_storage_rls.sql");

function readSql(path: string) {
  return readFileSync(path, "utf8");
}

function stripLineComments(sql: string) {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

function expectStaticSqlParse(sql: string) {
  const dollarQuotes = sql.match(/\$\$/g) ?? [];
  expect(dollarQuotes.length % 2).toBe(0);
  expect(stripLineComments(sql).trim()).toMatch(/;$/);
  expect(sql).not.toMatch(/\bcreate\s+trigger\b/i);
}

function allowedDomains(sql: string) {
  const match = sql.match(/allowed_domains\s+text\[\]\s*:=\s*array\[([\s\S]*?)\]/);
  if (!match) throw new Error("allowed_domains declaration not found");
  return Array.from(match[1].matchAll(/'([^']+)'/g), (m) => m[1].toLowerCase());
}

function simulateAuthBlockExternalDomains(domains: string[], email: string) {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  if (!domain) {
    return {
      error: { http_code: 400, message: "Email is required." },
    };
  }
  if (!domains.includes(domain)) {
    return {
      error: {
        http_code: 403,
        message: `Signup is restricted to internal addresses (${domain} not allowed).`,
      },
    };
  }
  return {};
}

describe("security baseline SQL migrations", () => {
  it("statically parses the re-enabled auth-domain and storage RLS migrations", () => {
    expect(existsSync(authMigration)).toBe(true);
    expect(existsSync(`${authMigration}.disabled`)).toBe(false);
    expect(existsSync(storageMigration)).toBe(true);
    expect(existsSync(`${storageMigration}.disabled`)).toBe(false);

    expectStaticSqlParse(readSql(authMigration));
    expectStaticSqlParse(readSql(storageMigration));
  });

  it("defines bucket-scoped storage policies for allowed card uploads and member reads", () => {
    const sql = stripLineComments(readSql(storageMigration));
    const policyBlocks = sql.split(/\bcreate\s+policy\b/i).slice(1);

    expect(sql).toMatch(
      /create\s+policy\s+card_attachments_member_insert\s+on\s+storage\.objects\s+for\s+insert\s+to\s+authenticated/i,
    );
    expect(sql).toMatch(/bucket_id\s*=\s*'card-attachments'/i);
    expect(sql).toMatch(/\(storage\.foldername\(name\)\)\[1\]\s*=\s*'cards'/i);
    expect(sql).toMatch(
      /from\s+public\.cards\s+c\s+join\s+public\.board_members\s+bm/i,
    );
    expect(sql).toMatch(
      /create\s+policy\s+card_attachments_member_read\s+on\s+storage\.objects\s+for\s+select\s+to\s+authenticated/i,
    );
    expect(policyBlocks.length).toBeGreaterThanOrEqual(2);
    for (const block of policyBlocks) {
      expect(block).toMatch(/bucket_id\s*=\s*'card-attachments'/i);
      expect(block).not.toMatch(/\bwith\s+check\s*\(\s*true\s*\)/i);
      expect(block).not.toMatch(/\busing\s*\(\s*true\s*\)/i);
    }
  });

  it("rejects a non-allowed signup email through the auth-domain hook logic", () => {
    const sql = readSql(authMigration);
    expect(sql).toMatch(
      /function\s+public\.auth_block_external_domains\(event\s+jsonb\)\s+returns\s+jsonb/i,
    );
    expect(sql).toMatch(/event->'user'->>'email'/);
    expect(sql).toMatch(/to\s+supabase_auth_admin/i);
    expect(sql).toMatch(/from\s+authenticated,\s*anon,\s*public/i);

    const actual = simulateAuthBlockExternalDomains(
      allowedDomains(sql),
      "outsider@example.com",
    );

    expect(actual).toEqual({
      error: {
        http_code: 403,
        message:
          "Signup is restricted to internal addresses (example.com not allowed).",
      },
    });
  });
});
