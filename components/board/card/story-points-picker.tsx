"use client";
import { useState, useTransition } from "react";
import { useBoardStore } from "@/stores/board-store";
import { useIsGuest } from "@/lib/permissions/use-is-guest";
import { updateCard } from "@/actions/cards";
import { toast } from "sonner";
import { Hash } from "lucide-react";
import { undoBus } from "@/lib/undo-bus";

const FIB = [1, 2, 3, 5, 8, 13];

export function StoryPointsPicker({
  cardId,
  storyPoints,
}: {
  cardId: string;
  storyPoints: number | null;
}) {
  const updateCardLocal = useBoardStore((s) => s.updateCard);
  const isGuest = useIsGuest();
  const [pending, start] = useTransition();
  const [showCustom, setShowCustom] = useState(false);
  const [custom, setCustom] = useState<string>("");

  if (isGuest) {
    if (storyPoints == null) return null;
    return (
      <div className="space-y-2" data-testid="story-points-picker">
        <div className="mono-meta text-fg flex items-center gap-1">
          <Hash className="size-3" /> Story points
        </div>
        <span className="chip bg-fg/10 text-fg ring-1 ring-fg/40 min-w-9 justify-center inline-flex">
          {storyPoints}
        </span>
      </div>
    );
  }

  function set(next: number | null) {
    if (next === storyPoints) return;
    const prev = storyPoints;
    updateCardLocal(cardId, { storyPoints: next } as { storyPoints: number | null });
    start(async () => {
      try {
        await updateCard({ id: cardId, storyPoints: next });
        const write = async (to: number | null, from: number | null) => {
          updateCardLocal(cardId, { storyPoints: to } as {
            storyPoints: number | null;
          });
          try {
            await updateCard({ id: cardId, storyPoints: to });
          } catch (err) {
            updateCardLocal(cardId, { storyPoints: from } as {
              storyPoints: number | null;
            });
            toast.error("Undo failed: " + (err as Error).message);
            throw err;
          }
        };
        undoBus.push({
          message: next == null ? "Story points cleared" : "Story points updated",
          undo: () => write(prev, next),
          redo: () => write(next, prev),
        });
      } catch (err) {
        updateCardLocal(cardId, { storyPoints: prev } as {
          storyPoints: number | null;
        });
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <div className="space-y-2" data-testid="story-points-picker">
      <div className="mono-meta text-fg flex items-center gap-1">
        <Hash className="size-3" /> Story points
      </div>
      <div className="flex flex-wrap gap-1">
        {FIB.map((n) => (
          <button
            key={n}
            type="button"
            disabled={pending}
            onClick={() => set(storyPoints === n ? null : n)}
            className={`chip min-w-9 justify-center hover:bg-[rgb(255_255_255/0.08)] transition-colors ${
              storyPoints === n ? "bg-fg/10 text-fg ring-1 ring-fg/40" : ""
            }`}
          >
            {n}
          </button>
        ))}
        <button
          type="button"
          disabled={pending}
          onClick={() => setShowCustom((v) => !v)}
          className="chip"
        >
          ?
        </button>
        <button
          type="button"
          disabled={pending || storyPoints === null}
          onClick={() => set(null)}
          className="chip text-fg-faint"
        >
          CLEAR
        </button>
      </div>
      {showCustom && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(custom);
            if (Number.isFinite(n) && n >= 0 && n <= 999) {
              set(Math.round(n));
              setShowCustom(false);
              setCustom("");
            } else {
              toast.error("0 to 999 only.");
            }
          }}
          className="flex gap-2 items-center"
        >
          <input
            type="number"
            min={0}
            max={999}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            className="h-8 w-20 px-2 rounded border border-hairline bg-transparent text-fg text-sm"
            placeholder="N"
            autoFocus
          />
          <button type="submit" className="chip">
            SET
          </button>
        </form>
      )}
    </div>
  );
}
