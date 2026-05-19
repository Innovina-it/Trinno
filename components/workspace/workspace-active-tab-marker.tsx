"use client";

import { useEffect } from "react";

import { useUserPreferences } from "@/lib/preferences/provider";
import { patchWorkspacePreferences } from "@/lib/preferences/scoped";
import { type WorkspacePreferenceTab } from "@/lib/preferences/types";

export function WorkspaceActiveTabMarker({
  workspaceId,
  tab,
}: {
  workspaceId: string;
  tab: WorkspacePreferenceTab;
}) {
  const { setPreferences } = useUserPreferences();

  useEffect(() => {
    setPreferences((current) =>
      patchWorkspacePreferences(current, workspaceId, { activeTab: tab }),
    );
  }, [setPreferences, tab, workspaceId]);

  return null;
}
