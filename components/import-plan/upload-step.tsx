"use client";

import { useRef, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ProjectPlan } from "@/lib/plan-import/types";
import {
  UPLOAD_ACCEPT,
  SUPPORTED_UPLOAD_LABEL,
  isSupportedUpload,
} from "@/lib/plan-import/supported-types";

const MAX_MB = 15;

function sizeLabel(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function UploadStep({
  driveFolderId,
  onDriveFolderId,
  onExtracted,
}: {
  driveFolderId: string;
  onDriveFolderId: (v: string) => void;
  onExtracted: (plan: ProjectPlan) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Stage a chosen file (validate only). Extraction does NOT start here — the
  // user reviews the Drive folder, then presses Extract.
  function pick(f: File) {
    setDragging(false);
    if (!isSupportedUpload(f.type)) {
      setError(`Unsupported file. Choose a ${SUPPORTED_UPLOAD_LABEL} (export Word/Excel as PDF first).`);
      return;
    }
    if (f.size > MAX_MB * 1024 * 1024) {
      setError(`That file is over ${MAX_MB} MB. Use a smaller export.`);
      return;
    }
    setError(null);
    setFile(f);
  }

  async function extract() {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("pdf", file);
      const res = await fetch("/api/import-plan/extract", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Extraction failed.");
      onExtracted(json.plan as ProjectPlan);
    } catch (e) {
      setError(
        `Couldn't read that file: ${e instanceof Error ? e.message : "unknown error"}. Try again, or pick another file.`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <button
        type="button"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) pick(f);
        }}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed px-6 py-12 text-center transition-[background-color,border-color] duration-200 ease-out outline-none",
          "border-[color:var(--hairline-hi)] bg-[color:var(--surface)]",
          "hover:bg-[color:var(--surface-strong)] focus-visible:ring-1 focus-visible:ring-fg/40",
          dragging && "bg-[color:var(--surface-strong)] border-fg/40",
          busy && "pointer-events-none opacity-60",
        )}
      >
        <FileText className="size-5 text-fg-muted" />
        {file ? (
          <>
            <span className="text-sm text-fg">{file.name}</span>
            <span className="mono-meta text-fg-faint">{sizeLabel(file.size)} · click to replace</span>
          </>
        ) : (
          <>
            <span className="text-sm text-fg">Drop a project-plan file, or click to choose.</span>
            <span className="font-serif text-sm italic text-fg-faint">
              {SUPPORTED_UPLOAD_LABEL}, up to {MAX_MB} MB
            </span>
          </>
        )}
      </button>

      <input
        ref={fileRef}
        type="file"
        accept={UPLOAD_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) pick(f);
          if (fileRef.current) fileRef.current.value = "";
        }}
      />

      <div className="space-y-2">
        <Label>Google Drive folder for deliverable docs (optional)</Label>
        <Input
          type="text"
          value={driveFolderId}
          disabled={busy}
          onChange={(e) => onDriveFolderId(e.target.value)}
          placeholder="Drive folder ID or link"
        />
        <p className="text-xs text-fg-faint">
          Share the folder with the service account as Editor, then paste its link. Leave blank
          to skip Drive docs; deliverables get a placeholder link you can edit later.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button type="button" onClick={extract} disabled={!file || busy} className="gap-2">
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          {busy ? "Reading the plan…" : "Extract plan"}
        </Button>
        {busy && (
          <span className="text-sm text-fg-muted">This can take up to a minute.</span>
        )}
      </div>

      {error && <p className="text-sm text-[color:var(--accent-magenta)]">{error}</p>}
    </div>
  );
}
