import "dotenv/config";
import { cache } from "react";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql as dsql } from "drizzle-orm";
import * as schema from "./schema";
import { getServiceSupabase } from "@/lib/supabase/service-role";
import { StructuredError } from "@/lib/errors";
import { logEvent } from "@/lib/observability/log";

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
    // Time the operation body. Logs only when it crosses the threshold;
    // the `finally` guarantees errors still propagate and the result is
    // returned unchanged.
    const startedAt = performance.now();
    try {
      return await fn(tx);
    } finally {
      const ms = performance.now() - startedAt;
      const thresholdMs = Number(process.env.SLOW_QUERY_MS ?? 500);
      if (ms > thresholdMs) {
        logEvent({ type: "slow-query", ms: Math.round(ms), thresholdMs });
      }
    }
  });
}

// Per-workspace advisory lock for analysis runs. A run spans many short
// queries/connections, so the lock is held on a RESERVED connection for the
// whole run, then released. A second concurrent run for the same workspace
// can't acquire the lock and is rejected with CONFLICT (409), so two runs never
// produce duplicate reports. Keyed by hashtext(workspaceId) → a stable bigint.
export async function withWorkspaceRunLock<T>(
  workspaceId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const conn = await queryClient.reserve();
  try {
    const rows = await conn<{ locked: boolean }[]>`
      select pg_try_advisory_lock(hashtext(${workspaceId})) as locked
    `;
    if (!rows[0]?.locked) {
      throw new StructuredError(
        "CONFLICT",
        "An analysis is already running for this workspace. Try again in a moment.",
      );
    }
    try {
      return await fn();
    } finally {
      await conn`select pg_advisory_unlock(hashtext(${workspaceId}))`;
    }
  } finally {
    conn.release();
  }
}
