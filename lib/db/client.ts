import "dotenv/config";
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

export async function dbAsUser<T>(
  jwt: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const claims = decodeJwt(jwt);
    await tx.execute(dsql`select set_config('role', 'authenticated', true)`);
    await tx.execute(
      dsql`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`,
    );
    return fn(tx);
  });
}

function decodeJwt(jwt: string): Record<string, unknown> {
  const [, payload] = jwt.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}
