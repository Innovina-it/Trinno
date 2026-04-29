"use client";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBoardStore } from "@/stores/board-store";
import { createLabel, toggleCardLabel } from "@/actions/labels";

const PALETTE = [
  "#61bd4f", // green
  "#f2d600", // yellow
  "#ff9f1a", // orange
  "#eb5a46", // red
  "#c377e0", // purple
  "#0079bf", // blue
];

export function LabelsSection({ cardId }: { cardId: string }) {
  const boardId = useBoardStore((s) => s.boardId);
  const labels = useBoardStore((s) => s.labels);
  const cardLabels = useBoardStore((s) => s.cardLabels);
  const addLabel = useBoardStore((s) => s.addLabel);
  const addCardLabel = useBoardStore((s) => s.addCardLabel);
  const removeCardLabel = useBoardStore((s) => s.removeCardLabel);

  const [name, setName] = useState("");
  const [color, setColor] = useState(PALETTE[0]);
  const [pending, start] = useTransition();

  const attachedIds = useMemo(
    () =>
      new Set(
        cardLabels.filter((cl) => cl.cardId === cardId).map((cl) => cl.labelId),
      ),
    [cardLabels, cardId],
  );

  function onAdd() {
    const trimmed = name.trim();
    start(async () => {
      try {
        const row = await createLabel({ boardId, name: trimmed, color });
        addLabel({
          id: row.id,
          boardId: row.boardId,
          name: row.name,
          color: row.color,
        });
        setName("");
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  function onToggle(labelId: string) {
    const wasAttached = attachedIds.has(labelId);
    // optimistic
    if (wasAttached) {
      removeCardLabel(cardId, labelId);
    } else {
      addCardLabel({ cardId, labelId });
    }
    start(async () => {
      try {
        await toggleCardLabel({ cardId, labelId });
      } catch (err) {
        // rollback
        if (wasAttached) addCardLabel({ cardId, labelId });
        else removeCardLabel(cardId, labelId);
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <section className="space-y-2" data-testid="labels-section">
      <h3 className="text-sm font-semibold">Labels</h3>
      {labels.length === 0 ? (
        <p className="text-xs text-muted-foreground">No labels yet.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {labels.map((l) => {
            const attached = attachedIds.has(l.id);
            return (
              <li key={l.id}>
                <button
                  type="button"
                  onClick={() => onToggle(l.id)}
                  data-label-id={l.id}
                  data-attached={attached ? "true" : "false"}
                  disabled={pending}
                  className="flex items-center gap-2 rounded px-2 py-1 text-xs text-white"
                  style={{
                    backgroundColor: l.color,
                    outline: attached ? "2px solid #111" : "none",
                  }}
                  title={attached ? "Click to detach" : "Click to attach"}
                >
                  <span>{l.name || l.color}</span>
                  <span aria-hidden>{attached ? "✓" : "+"}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="space-y-1.5 pt-2">
        <Label htmlFor="new-label">New label</Label>
        <div className="flex items-center gap-2">
          <Input
            id="new-label"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Label name (optional)"
            maxLength={60}
            className="flex-1"
          />
          <select
            value={color}
            onChange={(e) => setColor(e.target.value)}
            aria-label="Label color"
            className="rounded-md border border-input bg-transparent px-2 py-1.5 text-sm"
          >
            {PALETTE.map((c) => (
              <option key={c} value={c} style={{ backgroundColor: c }}>
                {c}
              </option>
            ))}
          </select>
          <Button type="button" onClick={onAdd} disabled={pending}>
            Add
          </Button>
        </div>
      </div>
    </section>
  );
}
