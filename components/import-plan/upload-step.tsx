"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ProjectPlan } from "@/lib/plan-import/types";

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
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(file: File) {
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
      setError(e instanceof Error ? e.message : "Extraction failed.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label>Project-plan PDF</Label>
        <Input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
          }}
        />
      </div>

      <div className="space-y-2">
        <Label>Google Drive folder for deliverable docs (optional)</Label>
        <Input
          type="text"
          value={driveFolderId}
          disabled={busy}
          onChange={(e) => onDriveFolderId(e.target.value)}
          placeholder="Drive folder ID or link"
        />
        <p className="text-xs text-fg-muted">
          Share the folder with the service account as Editor, then paste its link. Leave blank
          to skip Drive docs — deliverables get a placeholder link you can edit later.
        </p>
      </div>

      {busy && (
        <p className="flex items-center gap-2 text-sm text-fg-muted">
          <Upload className="size-3.5 animate-pulse" />
          Extracting… this can take up to a minute for a long PDF.
        </p>
      )}
      {error && <p className="text-sm text-[color:var(--accent-magenta)]">{error}</p>}
    </div>
  );
}
