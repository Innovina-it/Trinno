"use client";

import { useEffect } from "react";

import { useUserPreferences } from "@/lib/preferences/provider";

/**
 * Persists the current workspace id as `lastWorkspaceId` in the user's
 * preferences whenever any page under `/w/{workspaceId}/*` mounts. The
 * home page (`/`) reads this on next sign-in so the user lands back in
 * the workspace they were last in, instead of always being redirected
 * to the first workspace in their roster.
 *
 * Mounted in the workspace layout, so it fires for every workspace
 * sub-route (roadmap, boards, backlog, settings, …) without each page
 * having to opt in.
 */
export function WorkspaceVisitMarker({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const { preferences, setPreferences } = useUserPreferences();

  useEffect(() => {
    if (preferences.lastWorkspaceId === workspaceId) return;
    setPreferences({ lastWorkspaceId: workspaceId });
  }, [preferences.lastWorkspaceId, setPreferences, workspaceId]);

  return null;
}
