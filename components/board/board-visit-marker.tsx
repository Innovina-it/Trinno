"use client";

import { useEffect } from "react";

import { useUserPreferences } from "@/lib/preferences/provider";
import { patchWorkspacePreferences } from "@/lib/preferences/scoped";

/**
 * Persists the current board id as `workspaces[wsId].lastBoardId` whenever
 * any page under `/b/{boardId}/*` mounts. The workspace landing page
 * (`/w/{wsId}`) reads this on next sign-in (when the active tab is
 * "board") so the user lands back in the board they left instead of the
 * board picker.
 *
 * Mounted in the board layout — fires for every board sub-route (card
 * modal, settings) without each page having to opt in.
 */
export function BoardVisitMarker({
  workspaceId,
  boardId,
}: {
  workspaceId: string;
  boardId: string;
}) {
  const { preferences, setPreferences } = useUserPreferences();

  useEffect(() => {
    const current = preferences.workspaces?.[workspaceId]?.lastBoardId;
    if (current === boardId) return;
    setPreferences((cur) =>
      patchWorkspacePreferences(cur, workspaceId, { lastBoardId: boardId }),
    );
  }, [boardId, preferences.workspaces, setPreferences, workspaceId]);

  return null;
}
