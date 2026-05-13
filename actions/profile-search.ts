"use server";
import { sql, and, eq, or, ilike, ne, inArray } from "drizzle-orm";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { profiles, boards } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";

// Service-role client for auth.users.email lookups (RLS forbids that
// table to authenticated callers). Used only by searchProfiles so users
// can be found by their full email, not just their slug/handle.
function adminAuthClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// Map an email-shaped query → set of auth.user.ids whose emails start with
// the query. Returns null when service role isn't configured (dev fallback
// — search degrades to handle/name only). Capped at 100 lookups.
async function userIdsByEmailPrefix(q: string): Promise<Set<string> | null> {
  const admin = adminAuthClient();
  if (!admin) return null;
  // supabase-js doesn't expose a direct WHERE on auth.users, but listUsers
  // (admin API) supports a `filter` param documented for GoTrue. We use
  // pagination conservatively: 200 users / page * 1 page = 200 max scan.
  // For internal-tool scale (≤ a few hundred users) this is fine.
  const { data, error } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (error || !data?.users) return new Set();
  const needle = q.toLowerCase();
  const ids = new Set<string>();
  for (const u of data.users) {
    if (u.email && u.email.toLowerCase().includes(needle)) ids.add(u.id);
  }
  return ids;
}

// Service-role profile search that bypasses RLS. The invite picker needs to
// surface profiles the caller hasn't yet shared a workspace with — RLS
// (profiles_self_select, migration 0003) hides those rows, so a tx-scoped
// ilike on handle/display_name would only ever return existing co-members
// no matter what the user types. Returns null when service-role isn't
// configured so the caller can fall back to the RLS-scoped path.
async function adminProfileCandidates(
  q: string,
  qLocal: string,
  emailMatchIds: string[],
  me: string,
): Promise<{ id: string; handle: string | null; displayName: string }[] | null> {
  const admin = adminAuthClient();
  if (!admin) return null;
  const queries = [
    admin
      .from("profiles")
      .select("id, handle, display_name")
      .ilike("handle", `${q}%`)
      .neq("id", me)
      .limit(24),
    admin
      .from("profiles")
      .select("id, handle, display_name")
      .ilike("display_name", `%${q}%`)
      .neq("id", me)
      .limit(24),
  ];
  if (qLocal && qLocal !== q) {
    queries.push(
      admin
        .from("profiles")
        .select("id, handle, display_name")
        .ilike("handle", `${qLocal}%`)
        .neq("id", me)
        .limit(24),
      admin
        .from("profiles")
        .select("id, handle, display_name")
        .ilike("display_name", `%${qLocal}%`)
        .neq("id", me)
        .limit(24),
    );
  }
  if (emailMatchIds.length) {
    queries.push(
      admin
        .from("profiles")
        .select("id, handle, display_name")
        .in("id", emailMatchIds)
        .neq("id", me)
        .limit(48),
    );
  }
  const results = await Promise.all(queries);
  const dedup = new Map<
    string,
    { id: string; handle: string | null; displayName: string }
  >();
  for (const { data } of results) {
    for (const row of (data ?? []) as {
      id: string;
      handle: string | null;
      display_name: string;
    }[]) {
      if (!dedup.has(row.id)) {
        dedup.set(row.id, {
          id: row.id,
          handle: row.handle,
          displayName: row.display_name,
        });
      }
    }
  }
  return [...dedup.values()];
}

function decodeSub(jwt: string): string {
  const [, payload] = jwt.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).sub;
}

// Returns up to 8 mentionable profiles for the @-popover.  Scope:
// board_members of the given board + workspace_members of the board's
// workspace.  Filtered by `prefix` against handle and display_name
// (case-insensitive).  RLS already constrains `profiles` to those the
// caller can see.
export async function searchMentionables(
  boardId: string,
  prefix: string,
): Promise<{ id: string; handle: string; displayName: string }[]> {
  await requireUser();
  const token = (await getSessionToken())!;
  const me = decodeSub(token);
  const q = prefix.trim().toLowerCase();
  return dbAsUser(token, async (tx) => {
    // Resolve workspace_id for the board.
    const [b] = await tx
      .select({ workspaceId: boards.workspaceId })
      .from(boards)
      .where(eq(boards.id, boardId));
    if (!b) return [];

    // Two parallel sources, dedup on id, exclude self.
    const candidateIds = await tx
      .selectDistinct({ id: sql<string>`id` })
      .from(
        sql`(
          select user_id as id from public.board_members where board_id = ${boardId}
          union
          select user_id as id from public.workspace_members where workspace_id = ${b.workspaceId}
        ) as ids`,
      );
    const ids = candidateIds.map((r) => r.id).filter((id) => id !== me);
    if (ids.length === 0) return [];

    const where = q
      ? and(
          inArray(profiles.id, ids),
          or(
            ilike(profiles.handle, `${q}%`),
            ilike(profiles.displayName, `%${q}%`),
          ),
          ne(profiles.id, me),
        )
      : and(inArray(profiles.id, ids), ne(profiles.id, me));

    const rows = await tx
      .select({
        id: profiles.id,
        handle: profiles.handle,
        displayName: profiles.displayName,
      })
      .from(profiles)
      .where(where)
      .limit(8);
    return rows;
  });
}

// Cheap server action that returns ONLY the caller's collaborators
// (anyone who shares any workspace_members or board_members row with
// them). The client caches this list in localStorage so the create-
// workspace dialog can render an instant preload without re-querying
// every time it opens — see hooks/use-people-cache.ts.
export async function listCollaborators(): Promise<
  { id: string; handle: string | null; displayName: string }[]
> {
  await requireUser();
  const token = (await getSessionToken())!;
  const me = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    const collabIdRows = await tx
      .selectDistinct({ id: sql<string>`id` })
      .from(
        sql`(
          select wm2.user_id as id
            from public.workspace_members wm1
            join public.workspace_members wm2 on wm2.workspace_id = wm1.workspace_id
            where wm1.user_id = ${me} and wm2.user_id <> ${me}
          union
          select bm2.user_id as id
            from public.board_members bm1
            join public.board_members bm2 on bm2.board_id = bm1.board_id
            where bm1.user_id = ${me} and bm2.user_id <> ${me}
        ) as collab`,
      );
    const ids = collabIdRows.map((r) => r.id);
    if (ids.length === 0) return [];
    const rows = await tx
      .select({
        id: profiles.id,
        handle: profiles.handle,
        displayName: profiles.displayName,
      })
      .from(profiles)
      .where(inArray(profiles.id, ids));
    rows.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return rows;
  });
}

// Search profiles visible to the caller. Matches against:
//   - profiles.handle (prefix)
//   - profiles.display_name (substring)
//   - auth.users.email (substring, via service-role; degrades gracefully)
//
// Empty query → anchor on past collaborators (anyone who shares any
// workspace_members or board_members row with the caller) so the preload
// always surfaces people the user is likely to invite. Fill the rest with
// general profiles to the 12-row cap.
export async function searchProfiles(
  query: string,
): Promise<{ id: string; handle: string | null; displayName: string }[]> {
  await requireUser();
  const token = (await getSessionToken())!;
  const me = decodeSub(token);
  const q = query.trim().toLowerCase();
  // Email matches happen in parallel with the SQL phase.
  const emailIdsP = q ? userIdsByEmailPrefix(q) : Promise.resolve(null);
  return dbAsUser(token, async (tx) => {
    // Collaborators — used both for ranking and to guarantee preload coverage.
    const collabRows = await tx
      .selectDistinct({ id: sql<string>`id` })
      .from(
        sql`(
          select wm2.user_id as id
            from public.workspace_members wm1
            join public.workspace_members wm2 on wm2.workspace_id = wm1.workspace_id
            where wm1.user_id = ${me} and wm2.user_id <> ${me}
          union
          select bm2.user_id as id
            from public.board_members bm1
            join public.board_members bm2 on bm2.board_id = bm1.board_id
            where bm1.user_id = ${me} and bm2.user_id <> ${me}
        ) as collab`,
      );
    const collabSet = new Set(collabRows.map((r) => r.id));

    const emailIds = await emailIdsP;
    // Heuristic for seed/test handles. Matches handles where any hyphen-
    // segment looks generated rather than human-picked: a run of 10+ digits
    // (timestamps), or a 10+ char alphanumeric segment containing both
    // letters and digits (base36 random IDs like `mp3xxiodib3q`). Real
    // handles derived from email local-parts virtually never look like this.
    const isSeedHandle = (handle: string | null): boolean => {
      if (!handle) return false;
      for (const seg of handle.split("-")) {
        if (/^\d{10,}$/.test(seg)) return true;
        if (seg.length >= 10 && /\d/.test(seg) && /[a-z]/i.test(seg))
          return true;
      }
      return false;
    };

    if (!q) {
      // Empty query — preload. ALWAYS include collaborators first; pad
      // with general profiles to 12. Avoids the prior bug where the 48-row
      // alphabetical slice could omit the user's actual collaborators.
      const collabIds = [...collabSet];
      const collabRowsFull = collabIds.length
        ? await tx
            .select({
              id: profiles.id,
              handle: profiles.handle,
              displayName: profiles.displayName,
            })
            .from(profiles)
            .where(inArray(profiles.id, collabIds))
        : [];
      const remaining = Math.max(0, 12 - collabRowsFull.length);
      const fillerRows = remaining
        ? await tx
            .select({
              id: profiles.id,
              handle: profiles.handle,
              displayName: profiles.displayName,
            })
            .from(profiles)
            .where(ne(profiles.id, me))
            .limit(36)
        : [];
      const collabIdsSet = new Set(collabRowsFull.map((r) => r.id));
      const filler = fillerRows
        .filter((r) => !collabIdsSet.has(r.id))
        .filter((r) => !isSeedHandle(r.handle));
      const merged = [...collabRowsFull, ...filler];
      merged.sort((a, b) => {
        const aCollab = collabSet.has(a.id) ? 0 : 1;
        const bCollab = collabSet.has(b.id) ? 0 : 1;
        if (aCollab !== bCollab) return aCollab - bCollab;
        return a.displayName.localeCompare(b.displayName);
      });
      return merged.slice(0, 12);
    }

    // Non-empty query — match handle prefix, name substring, OR email match.
    // When the query looks like an email, also try the local-part: handles
    // and display_names are derived from `split_part(email,'@',1)` at signup
    // (see migration 0066), so a full-email query would otherwise miss the
    // very profile the user is trying to find whenever the service-role
    // email lookup is unavailable or paged past.
    const emailMatchIds = emailIds ? [...emailIds].filter((id) => id !== me) : [];
    const qLocal = q.includes("@") ? q.split("@")[0] : "";

    // Prefer the service-role candidate search: profiles RLS only exposes
    // workspace co-members to the caller (migration 0003), but the invite
    // picker explicitly wants to find strangers by handle, name, or email.
    // Falls back to the RLS-scoped tx search in dev when service-role isn't
    // configured — that path can only surface co-members, but it's better
    // than nothing.
    const adminRows = await adminProfileCandidates(q, qLocal, emailMatchIds, me);
    let rows: { id: string; handle: string | null; displayName: string }[];
    if (adminRows) {
      rows = adminRows;
    } else {
      const ors = [
        ilike(profiles.handle, `${q}%`),
        ilike(profiles.displayName, `%${q}%`),
      ];
      if (qLocal && qLocal !== q) {
        ors.push(ilike(profiles.handle, `${qLocal}%`));
        ors.push(ilike(profiles.displayName, `%${qLocal}%`));
      }
      if (emailMatchIds.length) ors.push(inArray(profiles.id, emailMatchIds));
      const where = or(...ors);
      rows = await tx
        .select({
          id: profiles.id,
          handle: profiles.handle,
          displayName: profiles.displayName,
        })
        .from(profiles)
        .where(and(where, ne(profiles.id, me)))
        .limit(48);
    }

    // Drop seed/test profiles (handles like `act-1778669520333-mnlr`) — the
    // service-role path returns them too since RLS no longer hides them.
    // Always keep collaborators even if their handle matches the pattern
    // (real but unusually-named user shouldn't disappear from their own
    // co-member list).
    rows = rows.filter(
      (r) => collabSet.has(r.id) || !isSeedHandle(r.handle),
    );

    rows.sort((a, b) => {
      const aCollab = collabSet.has(a.id) ? 0 : 1;
      const bCollab = collabSet.has(b.id) ? 0 : 1;
      if (aCollab !== bCollab) return aCollab - bCollab;
      return a.displayName.localeCompare(b.displayName);
    });
    return rows.slice(0, 12);
  });
}
