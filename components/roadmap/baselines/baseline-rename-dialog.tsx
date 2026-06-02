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
import { updateRoadmapBaseline } from "@/actions/roadmap-baselines";
import type { BaselineMeta } from "@/lib/baselines/types";
import { toast } from "sonner";

export function BaselineRenameDialog({
  open,
  onOpenChange,
  baseline,
  onRenamed,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  baseline: BaselineMeta;
  onRenamed: (next: { id: string; name: string; note: string | null }) => void;
}) {
  const [name, setName] = useState(baseline.name);
  const [note, setNote] = useState(baseline.note ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName(baseline.name);
      setNote(baseline.note ?? "");
    }
  }, [open, baseline.name, baseline.note]);

  async function submit() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const res = await updateRoadmapBaseline({
        id: baseline.id,
        name: name.trim(),
        note: note.trim() || null,
      });
      if (res.ok) {
        onRenamed({
          id: baseline.id,
          name: name.trim(),
          note: note.trim() || null,
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
      <DialogContent className="max-w-md" data-testid="baseline-rename-dialog">
        <DialogHeader>
          <DialogTitle>Rename baseline</DialogTitle>
        </DialogHeader>

        <label className="block text-xs text-fg-faint mb-1">Name</label>
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Q3 plan of record"
          data-testid="baseline-rename-name"
        />

        <label className="block text-xs text-fg-faint mb-1 mt-3">
          Note <span className="text-fg-faint/70">(optional)</span>
        </label>
        <textarea
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What does this baseline capture?"
          data-testid="baseline-rename-note"
          className="w-full resize-y min-h-[4.5rem] rounded-md border border-[color:var(--hairline)] bg-[color:var(--surface)] p-2 text-sm outline-none focus-visible:border-[color:var(--accent-cyan)]/60"
        />

        <DialogFooter className="mt-4">
          <Button
            onClick={submit}
            disabled={busy || name.trim().length === 0}
            data-testid="baseline-rename-submit"
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
