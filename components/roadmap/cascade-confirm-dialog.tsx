"use client";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { cascadeShiftBlockedAfter, shiftCardsByIds } from "@/actions/cards";
import { undoBus } from "@/lib/undo-bus";

// Plan #16b-γ-A (#4) — confirmation surface for the auto-cascade flow.
// We surface the count of affected cards (capped at 20 in the preview)
// alongside a tally of how many more weren't shown, then call the
// server-side cascade action when the user confirms. The originating
// drag has already persisted, so cancelling here just leaves dependents
// untouched.

export type CascadeAffectedCard = {
  id: string;
  title: string;
};

const PREVIEW_CAP = 20;

export function CascadeConfirmDialog({
  open,
  onOpenChange,
  rootCardId,
  deltaDays,
  affectedCards,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  rootCardId: string | null;
  deltaDays: number;
  affectedCards: CascadeAffectedCard[];
  onApplied?: (shifted: { id: string; deltaDays: number }[]) => void;
}) {
  const [pending, startT] = useTransition();
  const previewed = affectedCards.slice(0, PREVIEW_CAP);
  const moreCount = Math.max(0, affectedCards.length - PREVIEW_CAP);
  const deltaLabel =
    deltaDays > 0 ? `+${deltaDays} day${deltaDays === 1 ? "" : "s"}` : `${deltaDays} day${Math.abs(deltaDays) === 1 ? "" : "s"}`;

  function onConfirm() {
    if (!rootCardId) {
      onOpenChange(false);
      return;
    }
    startT(async () => {
      try {
        const r = await cascadeShiftBlockedAfter({
          cardId: rootCardId,
          deltaDays,
        });
        toast.success(
          `Shifted ${r.shifted.length} card${
            r.shifted.length === 1 ? "" : "s"
          }`,
        );
        onApplied?.(r.shifted);
        if (r.shifted.length > 0) {
          const ids = r.shifted.map((s) => s.id);
          const replay = async (delta: number) => {
            try {
              const rr = await shiftCardsByIds({ cardIds: ids, deltaDays: delta });
              onApplied?.(rr.shifted);
            } catch (err) {
              toast.error((err as Error).message);
              throw err;
            }
          };
          undoBus.push({
            message: `Shifted ${r.shifted.length} dependent card${
              r.shifted.length === 1 ? "" : "s"
            }`,
            undo: () => replay(-deltaDays),
            redo: () => replay(deltaDays),
          });
        }
        onOpenChange(false);
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        data-testid="cascade-confirm-dialog"
      >
        <DialogHeader>
          <DialogTitle>Reschedule blocked dependents?</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-fg-muted">
            {affectedCards.length} card
            {affectedCards.length === 1 ? "" : "s"} are blocked by this one.
            Shift their start &amp; target by <strong>{deltaLabel}</strong>?
          </p>
          <ul className="max-h-56 overflow-auto space-y-1 border border-hairline rounded-lg p-2">
            {previewed.map((c) => (
              <li
                key={c.id}
                className="truncate"
                data-testid="cascade-affected-row"
                data-card-id={c.id}
              >
                {c.title}
              </li>
            ))}
            {moreCount > 0 && (
              <li className="mono-meta-sm text-fg-faint">
                + {moreCount} more
              </li>
            )}
          </ul>
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Skip
          </Button>
          <Button
            onClick={onConfirm}
            disabled={pending || affectedCards.length === 0}
            data-testid="cascade-confirm"
          >
            {pending ? "Shifting…" : `Shift ${affectedCards.length}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
