import "dotenv/config";
import { cache } from "react";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql as dsql } from "drizzle-orm";
import * as schema from "./schema";
import { getServiceSupabase } from "@/lib/supabase/service-role";
import { StructuredError } from "@/lib/errors";

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

// Validate the access token against Supabase Auth BEFORE its claims are
// trusted by Postgres RLS. GoTrue verifies the signature + expiry
// server-side (works for both HS256 local and asymmetric prod signing),
// so a forged or expired token never reaches `set_config`. Cached per
// token via React `cache` so it costs at most one roundtrip per unique
// token per request. Returns the authoritative `sub`.
//
// Why this exists: many `*Impl(token, …)` actions are exported from
// `"use server"` files and would otherwise trust an unverified,
// caller-supplied JWT. This choke point neutralizes that whole class —
// every privileged path runs its authorization query through dbAsUser.
const verifyAccessToken = cache(async (jwt: string): Promise<string> => {
  const { data, error } = await getServiceSupabase().auth.getUser(jwt);
  if (error || !data.user) {
    throw new StructuredError("UNAUTHENTICATED", "Invalid or expired session.");
  }
  return data.user.id;
});

export async function dbAsUser<T>(
  jwt: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const verifiedSub = await verifyAccessToken(jwt);
  const claimsJson = getClaimsJson(jwt);
  // The claims handed to RLS must name the same identity GoTrue verified.
  // Guards against a validly-signed token paired with a swapped-out claims
  // payload reaching `request.jwt.claims`.
  const claimsSub = (JSON.parse(claimsJson) as { sub?: string }).sub;
  if (claimsSub !== verifiedSub) {
    throw new StructuredError("UNAUTHENTICATED", "Token identity mismatch.");
  }
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
