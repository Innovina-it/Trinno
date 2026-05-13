import "dotenv/config";
import { cache } from "react";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql as dsql } from "drizzle-orm";
import * as schema from "./schema";

const queryClient = postgres(process.env.DATABASE_URL!, {
  max: Number(process.env.DATABASE_POOL_MAX ?? 2),
  idle_timeout: 10,
  connect_timeout: 5,
  prepare: false,
});
// Internal: raw connection bypasses RLS. Never export — all callers must
// route through dbAsUser so queries run with the calling user's JWT.
const db = drizzle(queryClient, { schema });

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// React `cache` dedupes within one server request. Many `dbAsUser` calls
// in the same request decode the same JWT and re-stringify the same
// claims JSON — memoising both shaves per-call overhead. The cache key is
// the raw JWT string, so different users in the same request (unusual)
// still get distinct claim payloads.
const getClaimsJson = cache((jwt: string): string => {
  const [, payload] = jwt.split(".");
  const claims = JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  ) as Record<string, unknown>;
  return JSON.stringify(claims);
});

export async function dbAsUser<T>(
  jwt: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const claimsJson = getClaimsJson(jwt);
  return db.transaction(async (tx) => {
    // Combine the two SET round-trips into a single statement so each
    // dbAsUser call costs one server hop for bookkeeping instead of two.
    // Both are `set_local`-equivalent (3rd arg `true` = transaction-local)
    // so RLS still sees the right `request.jwt.claims` per-transaction.
    await tx.execute(
      dsql`select set_config('role', 'authenticated', true), set_config('request.jwt.claims', ${claimsJson}, true)`,
    );
    return fn(tx);
  });
}
