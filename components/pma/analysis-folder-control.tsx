"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setWorkspaceDriveFolderAction } from "@/actions/pma-folders";

// Short, recognizable label for a Drive folder URL (…/folders/<id>).
function folderLabel(url: string): string {
  const m = url.match(/\/folders\/([A-Za-z0-9_-]+)/);
  return m ? `…/folders/${m[1].slice(0, 12)}…` : url;
}

// The workspace's documents-folder setup, for the Analysis page. Quiet by
// default: the header just shows whether a folder is connected (with a link) or
// not, plus a Change/Set button. The Auto | Manual setup only appears when the
// user chooses to set or change it — so it never reads as stray controls.
export function AnalysisFolderControl({
  workspaceId,
  currentFolderUrl,
}: {
  workspaceId: string;
  currentFolderUrl: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const [folderId, setFolderId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  function openEditor() {
    setMode(currentFolderUrl ? "manual" : "auto");
    setFolderId(currentFolderUrl ?? "");
    setError(null);
    setEditing(true);
  }

  function save() {
    setError(null);
    startSave(async () => {
      const res = await setWorkspaceDriveFolderAction({
        workspaceId,
        mode,
        folderLink: mode === "manual" ? folderId : undefined,
      });
      if (!res.ok) setError(res.error);
      else {
        setEditing(false);
        router.refresh();
      }
    });
  }

  // Quiet status line (default).
  if (!editing) {
    return (
      <div className="flex items-center gap-3">
        <span className="mono-meta text-fg-faint">Documents folder</span>
        {currentFolderUrl ? (
          <a
            href={currentFolderUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate text-sm text-fg-muted underline-offset-2 hover:text-fg hover:underline"
            title={currentFolderUrl}
          >
            {folderLabel(currentFolderUrl)}
          </a>
        ) : (
          <span className="font-serif text-sm italic text-fg-faint">not set</span>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={openEditor}>
          {currentFolderUrl ? "Change" : "Set folder"}
        </Button>
      </div>
    );
  }

  // Editor (only when the user opens it).
  const seg = (active: boolean) =>
    cn(
      "h-8 rounded-full px-3.5 text-sm outline-none transition-colors focus-visible:ring-1 focus-visible:ring-fg/40",
      active
        ? "bg-fg font-medium text-[color:var(--bg-deep)]"
        : "text-fg-muted hover:text-fg",
    );

  return (
    <div className="space-y-2 rounded-xl border border-[color:var(--hairline)] bg-[color:var(--surface)] p-3">
      <span className="mono-meta text-fg-faint">Documents folder</span>
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="radiogroup"
          aria-label="Documents folder mode"
          className="inline-flex items-center gap-0.5 rounded-full border border-[color:var(--hairline)] bg-[color:var(--bg-deep)] p-0.5"
        >
          <button
            type="button"
            role="radio"
            aria-checked={mode === "auto"}
            onClick={() => setMode("auto")}
            className={seg(mode === "auto")}
          >
            Auto
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === "manual"}
            onClick={() => setMode("manual")}
            className={seg(mode === "manual")}
          >
            Manual
          </button>
        </div>
        {mode === "manual" && (
          <Input
            value={folderId}
            onChange={(e) => setFolderId(e.target.value)}
            placeholder="Drive folder link"
            aria-label="Drive folder link"
            className="max-w-sm"
          />
        )}
      </div>

      <p className="text-xs text-fg-faint">
        Where this workspace&apos;s project documents live in Drive. Analysis reads
        them; reports are written to a Reports sub-folder.{" "}
        {mode === "auto"
          ? "Auto creates (or reuses) a folder named after the workspace."
          : "Manual uses a Drive folder link you share with the service account."}
      </p>

      <div className="flex items-center gap-3">
        <Button
          type="button"
          onClick={save}
          disabled={saving || (mode === "manual" && !folderId.trim())}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setEditing(false);
            setError(null);
          }}
        >
          Cancel
        </Button>
        {error && (
          <span className="text-sm text-[color:var(--accent-magenta)]">{error}</span>
        )}
      </div>
    </div>
  );
}
