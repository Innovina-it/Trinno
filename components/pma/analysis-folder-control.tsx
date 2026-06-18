"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DriveModeControl } from "@/components/import-plan/drive-mode-control";
import type { DriveMode } from "@/components/import-plan/upload-step";
import { setWorkspaceDriveFolderAction } from "@/actions/pma-folders";

// Configure the workspace's documents folder on the Analysis page using the same
// segmented Auto | Manual control the import wizard uses. Auto provisions
// <project>/{Documents, Reports} under the shared Trinno root; Manual takes a
// pasted folder link. (The control's "Off" state is not meaningful here and is
// treated as Manual on save.)
export function AnalysisFolderControl({
  workspaceId,
  currentFolderUrl,
}: {
  workspaceId: string;
  currentFolderUrl: string | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<DriveMode>(currentFolderUrl ? "manual" : "auto");
  const [folderId, setFolderId] = useState(currentFolderUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  function save() {
    setError(null);
    startSave(async () => {
      const res = await setWorkspaceDriveFolderAction({
        workspaceId,
        mode: mode === "auto" ? "auto" : "manual",
        folderLink: folderId,
      });
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <DriveModeControl
        mode={mode}
        onMode={setMode}
        folderId={folderId}
        onFolderId={setFolderId}
        disabled={saving}
      />
      <div className="flex items-center gap-3">
        <Button type="button" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save documents folder"}
        </Button>
        {error && (
          <span className="text-sm text-[color:var(--accent-magenta)]">{error}</span>
        )}
      </div>
    </div>
  );
}
