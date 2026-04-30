"use client";
import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import type { versions as versionsTable } from "@/lib/db/schema";

export type VersionRow = typeof versionsTable.$inferSelect;

function rowToVersion(r: Record<string, unknown>): VersionRow {
  return {
    id: r.id as string,
    workspaceId: r.workspace_id as string,
    name: r.name as string,
    semver: (r.semver ?? null) as string | null,
    state: r.state as VersionRow["state"],
    releaseDate: r.release_date ? new Date(r.release_date as string) : null,
    description: (r.description ?? null) as string | null,
    createdAt: new Date(r.created_at as string),
    updatedAt: new Date(r.updated_at as string),
  };
}

function sorted(rows: VersionRow[]): VersionRow[] {
  return rows.slice().sort((a, b) => {
    const aTs = a.releaseDate ? a.releaseDate.getTime() : Number.POSITIVE_INFINITY;
    const bTs = b.releaseDate ? b.releaseDate.getTime() : Number.POSITIVE_INFINITY;
    if (aTs !== bTs) return aTs - bTs;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Workspace-scoped realtime subscription to the `versions` table. Used by
 * the versions list page, workspace settings panel, and the version picker
 * inside any card modal in the workspace.
 *
 * Returns versions sorted by releaseDate asc (nulls last) then by name.
 */
export function useWorkspaceVersions(
  workspaceId: string,
  initial: VersionRow[] = [],
): VersionRow[] {
  const [items, setItems] = useState<VersionRow[]>(() => sorted(initial));

  useEffect(() => {
    setItems(sorted(initial));
    // We intentionally only re-seed when workspaceId changes; for live
    // streams the realtime channel handles incremental updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  useEffect(() => {
    const supa = createSupabaseBrowser();
    let cancelled = false;
    let channel: ReturnType<typeof supa.channel> | null = null;

    (async () => {
      const { data } = await supa.auth.getSession();
      const token = data.session?.access_token;
      if (token) await supa.realtime.setAuth(token);
      if (cancelled) return;

      // Pull the latest snapshot to absorb any rows committed before mount.
      const { data: rows } = await supa
        .from("versions")
        .select("*")
        .eq("workspace_id", workspaceId);
      if (!cancelled && rows) {
        setItems(sorted(rows.map((r) => rowToVersion(r as Record<string, unknown>))));
      }

      const ch = supa.channel(`workspace-versions:${workspaceId}`);
      channel = ch;
      ch.on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "postgres_changes" as any,
        {
          event: "*",
          schema: "public",
          table: "versions",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          if (payload.eventType === "INSERT" && payload.new) {
            const v = rowToVersion(payload.new);
            setItems((curr) =>
              curr.some((x) => x.id === v.id) ? curr : sorted([...curr, v]),
            );
          } else if (payload.eventType === "UPDATE" && payload.new) {
            const v = rowToVersion(payload.new);
            setItems((curr) =>
              sorted(curr.map((x) => (x.id === v.id ? v : x))),
            );
          } else if (payload.eventType === "DELETE" && payload.old) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const id = (payload.old as any).id as string;
            setItems((curr) => curr.filter((x) => x.id !== id));
          }
        },
      ).subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) supa.removeChannel(channel);
    };
  }, [workspaceId]);

  return useMemo(() => items, [items]);
}
