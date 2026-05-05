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
    <section className="space-y-3" data-testid="labels-section">
      <div className="flex items-baseline justify-between border-b border-hairline pb-1">
        <h3 className="mono-meta text-fg-muted">Labels</h3>
      </div>
      {labels.length === 0 ? (
        <p className="italic text-sm text-fg-faint">No labels yet.</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
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
                  className="mono-meta-sm flex items-center gap-1.5 border px-2 py-1 text-paper transition-opacity hover:opacity-90 disabled:opacity-60"
                  style={{
                    backgroundColor: l.color,
                    borderColor: attached ? "var(--ink)" : l.color,
                    outline: attached ? "1px solid var(--ink)" : "none",
                    outlineOffset: attached ? "1px" : "0",
                  }}
                  title={attached ? "Click to detach" : "Click to attach"}
                >
                  <span className="tracking-wider">{l.name || l.color}</span>
                  <span aria-hidden className="text-paper/85">{attached ? "✓" : "+"}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="space-y-2 pt-2">
        <Label htmlFor="new-label">New label</Label>
        <div className="flex items-center gap-1.5">
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
            className="h-9 rounded-none border border-hairline-hi bg-[color:var(--surface)] px-2 text-sm font-mono"
          >
            {PALETTE.map((c) => (
              <option key={c} value={c} style={{ backgroundColor: c }}>
                {c}
              </option>
            ))}
          </select>
          <Button type="button" size="sm" onClick={onAdd} disabled={pending}>
            Add
          </Button>
        </div>
      </div>
    </section>
  );
}
