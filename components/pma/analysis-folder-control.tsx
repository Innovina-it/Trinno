"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Cloud, FolderPlus, Check, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setWorkspaceDriveFolderAction } from "@/actions/pma-folders";

// The workspace's documents-folder control for the Analysis page. Quiet status
// chip by default (no raw Drive id on screen); the Auto | Manual editor appears
// as a contained card only when the user sets or changes the folder.
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

  // ── Editor card (only when opened) ─────────────────────────────────────────
  if (editing) {
    const seg = (active: boolean) =>
      cn(
        "h-8 rounded-full px-3.5 text-sm outline-none transition-colors focus-visible:ring-1 focus-visible:ring-fg/40",
        active
          ? "bg-fg font-medium text-[color:var(--bg-deep)]"
          : "text-fg-muted hover:text-fg",
      );

    return (
      <div className="w-full max-w-md space-y-3 rounded-xl border border-[color:var(--hairline)] bg-[color:var(--surface)] p-3.5">
        <span className="mono-meta-sm tracking-[0.14em] text-fg-faint">
          DOCUMENTS FOLDER
        </span>
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
              className="min-w-0 flex-1"
            />
          )}
        </div>

        <p className="text-xs leading-relaxed text-fg-faint">
          Where this workspace&apos;s documents live in Drive. Analysis reads them;
          reports are written to a Reports sub-folder.{" "}
          {mode === "auto"
            ? "Auto creates (or reuses) a folder named after the workspace."
            : "Manual uses a Drive folder link shared with the service account."}
        </p>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={save}
            disabled={saving || (mode === "manual" && !folderId.trim())}
          >
            {saving ? "Saving" : "Save"}
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

  // ── Not set: a gentle call to action ───────────────────────────────────────
  if (!currentFolderUrl) {
    return (
      <button
        type="button"
        onClick={openEditor}
        className="inline-flex items-center gap-2 rounded-lg border border-dashed border-[color:var(--hairline-hi)] bg-[color:var(--surface)] py-1.5 pl-3 pr-3.5 text-sm text-fg-muted transition-colors hover:border-fg/40 hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40"
      >
        <FolderPlus className="size-3.5" />
        Set documents folder
      </button>
    );
  }

  // ── Connected: status chip (no raw id) ─────────────────────────────────────
  return (
    <div className="inline-flex items-center gap-2.5 rounded-lg border border-[color:var(--hairline-hi)] bg-[color:var(--surface)] py-1 pl-3 pr-1">
      <Cloud className="size-3.5 text-fg-muted" />
      <span className="text-sm text-fg">Documents folder</span>
      <span className="inline-flex items-center gap-1 mono-meta-sm text-[color:var(--accent-cyan)]">
        <Check className="size-3" /> linked
      </span>
      <span className="mx-0.5 h-4 w-px bg-[color:var(--hairline)]" aria-hidden />
      <a
        href={currentFolderUrl}
        target="_blank"
        rel="noopener noreferrer"
        title="Open in Drive"
        aria-label="Open documents folder in Drive"
        className="inline-flex size-7 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-[rgb(255_255_255/0.06)] hover:text-fg"
      >
        <ExternalLink className="size-3.5" />
      </a>
      <span className="mx-0.5 h-4 w-px bg-[color:var(--hairline)]" aria-hidden />
      <Button type="button" variant="ghost" size="sm" onClick={openEditor}>
        Change
      </Button>
    </div>
  );
}
