import { NextResponse } from "next/server";

// Reports the deployment ID currently serving requests. The client compares
// it against the ID baked into its bundle at build time
// (NEXT_PUBLIC_DEPLOYMENT_ID) to detect version skew — see
// components/system/version-watcher.tsx and lib/version/skew.ts.
//
// Must never be cached, and must NOT be pinned by Skew Protection: a plain
// client `fetch()` is not framework-pinned, so this always resolves to the
// latest production deployment, which is exactly what we want to compare
// the (possibly stale) client against.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET() {
  return NextResponse.json(
    { id: process.env.VERCEL_DEPLOYMENT_ID ?? "" },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
