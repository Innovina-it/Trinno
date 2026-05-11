// Helpers scoped to "the current authed user across every workspace
// they can see". Used by the /me home dashboard. RLS does the
// cross-workspace filtering so callers don't need a workspaceId.
//
// Panels add their own exported helpers below; this file deliberately
// avoids batching everything into one mega-query so each panel can be
// owned/tested independently.

import { dbAsUser } from "@/lib/db/client";

export async function meId(token: string): Promise<string> {
  const [, payload] = token.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).sub;
}

// Re-export for convenience so panel impls don't all reach into db/client.
export { dbAsUser };
