"use client";
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createRoadmapBaseline } from "@/actions/roadmap-baselines";
import type { BaselineMeta } from "@/lib/baselines/types";
import { toast } from "sonner";

export function BaselineSaveDialog({
  open,
  onOpenChange,
  onSaved,
  workspaceId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: (meta: BaselineMeta) => void;
  workspaceId: string;
}) {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setNote("");
    }
  }, [open]);

  async function submit() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const res = await createRoadmapBaseline({
        workspaceId,
        name: name.trim(),
        note: note.trim() || null,
      });
      if (res.ok) {
        onSaved({
          id: res.data.id,
          workspaceId,
          name: res.data.name,
          note: res.data.note ?? null,
          createdBy: res.data.createdBy,
          createdAt:
            res.data.createdAt instanceof Date
              ? res.data.createdAt.toISOString()
              : String(res.data.createdAt),
        });
        onOpenChange(false);
      } else {
        toast.error(res.error.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="baseline-save-dialog">
        <DialogHeader>
          <DialogTitle>Save baseline</DialogTitle>
        </DialogHeader>

        <label className="block text-xs text-fg-faint mb-1">Name</label>
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Q3 plan of record"
          data-testid="baseline-name-input"
        />

        <label className="block text-xs text-fg-faint mb-1 mt-3">
          Note <span className="text-fg-faint/70">(optional)</span>
        </label>
        <textarea
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What does this baseline capture?"
          data-testid="baseline-note-input"
          className="w-full resize-y min-h-[4.5rem] rounded-md border border-[color:var(--hairline)] bg-[color:var(--surface)] p-2 text-sm outline-none focus-visible:border-[color:var(--accent-cyan)]/60"
        />

        <DialogFooter className="mt-4">
          <Button
            onClick={submit}
            disabled={busy || name.trim().length === 0}
            data-testid="baseline-save-submit"
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
