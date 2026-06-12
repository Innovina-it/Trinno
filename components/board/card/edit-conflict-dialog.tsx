"use client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

// card-edit-concurrency U3 — the "keep yours or take theirs?" surface.
// Shown when a text save is rejected because someone else changed the
// same field meanwhile. Pure presentation: resolution lives at the
// calling surface (it owns local state + the retry write).

export type EditConflict = {
  field: "title" | "description";
  mine: string;
  theirs: string;
  currentRev: number;
};

export function EditConflictDialog({
  conflict,
  onResolve,
  onOpenChange,
}: {
  conflict: EditConflict | null;
  onResolve: (choice: "mine" | "theirs", conflict: EditConflict) => void;
  onOpenChange: (open: boolean) => void;
}) {
  if (!conflict) return null;
  const fieldLabel = conflict.field === "title" ? "title" : "description";
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent data-testid="edit-conflict-dialog" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Someone changed this {fieldLabel} while you were typing
          </DialogTitle>
          <DialogDescription>
            Pick which version to keep — nothing has been overwritten yet.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="space-y-1">
            <p className="mono-meta-sm text-fg-faint">YOURS</p>
            <p
              className="rounded-md border border-hairline bg-[color:var(--surface)] px-3 py-2 max-h-32 overflow-auto whitespace-pre-wrap"
              data-testid="conflict-mine"
            >
              {conflict.mine || <span className="text-fg-faint">(empty)</span>}
            </p>
          </div>
          <div className="space-y-1">
            <p className="mono-meta-sm text-fg-faint">THEIRS</p>
            <p
              className="rounded-md border border-hairline bg-[color:var(--surface)] px-3 py-2 max-h-32 overflow-auto whitespace-pre-wrap"
              data-testid="conflict-theirs"
            >
              {conflict.theirs || <span className="text-fg-faint">(empty)</span>}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            data-testid="conflict-take-theirs"
            onClick={() => onResolve("theirs", conflict)}
          >
            Take theirs
          </Button>
          <Button
            data-testid="conflict-keep-mine"
            onClick={() => onResolve("mine", conflict)}
          >
            Keep mine
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
