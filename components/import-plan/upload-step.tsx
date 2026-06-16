"use client";

import { useRef, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ProjectPlan } from "@/lib/plan-import/types";
import {
  UPLOAD_ACCEPT,
  SUPPORTED_UPLOAD_LABEL,
  isSupportedUpload,
} from "@/lib/plan-import/supported-types";

const MAX_MB = 15;

export function UploadStep({
  driveFolderId,
  onDriveFolderId,
  onExtracted,
}: {
  driveFolderId: string;
  onDriveFolderId: (v: string) => void;
  onExtracted: (plan: ProjectPlan) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function reject(msg: string) {
    setError(msg);
    setDragging(false);
  }

  async function onFile(file: File) {
    if (!isSupportedUpload(file.type))
      return reject(`Unsupported file. Drop a ${SUPPORTED_UPLOAD_LABEL} (export Word/Excel as PDF first).`);
    if (file.size > MAX_MB * 1024 * 1024)
      return reject(`That file is over ${MAX_MB} MB. Use a smaller export.`);
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
        `Couldn't read that PDF: ${e instanceof Error ? e.message : "unknown error"}. Try again, or enter the plan by hand.`,
      );
    } finally {
      setBusy(false);
      setDragging(false);
      if (fileRef.current) fileRef.current.value = "";
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
          if (f) onFile(f);
        }}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed px-6 py-12 text-center transition-[background-color,border-color] duration-200 ease-out outline-none",
          "border-[color:var(--hairline-hi)] bg-[color:var(--surface)]",
          "hover:bg-[color:var(--surface-strong)] focus-visible:ring-1 focus-visible:ring-fg/40",
          dragging && "bg-[color:var(--surface-strong)] border-fg/40",
          busy && "pointer-events-none opacity-60",
        )}
      >
        {busy ? (
          <Loader2 className="size-5 animate-spin text-fg-muted" />
        ) : (
          <FileText className="size-5 text-fg-muted" />
        )}
        <span className="text-sm text-fg">
          {busy ? "Reading the plan. This can take up to a minute." : "Drop a project-plan file, or click to choose."}
        </span>
        {!busy && (
          <span className="font-serif text-sm italic text-fg-faint">
            {SUPPORTED_UPLOAD_LABEL}, up to {MAX_MB} MB
          </span>
        )}
      </button>

      <input
        ref={fileRef}
        type="file"
        accept={UPLOAD_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
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

      {error && <p className="text-sm text-[color:var(--accent-magenta)]">{error}</p>}
    </div>
  );
}
