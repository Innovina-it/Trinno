"use client";
import { useTransition } from "react";
import { toast } from "sonner";
import { useBoardStore } from "@/stores/board-store";
import { useIsGuest } from "@/lib/permissions/use-is-guest";
import { updateCard } from "@/actions/cards";
import { DatePicker } from "@/components/ui/date-picker";
import type { CardRow } from "@/lib/queries/board-snapshot";
import { undoBus } from "@/lib/undo-bus";

function toDate(d: Date | string | null | undefined): Date | null {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
}

export function DueSection({ cardId }: { cardId: string }) {
  const card = useBoardStore((s) =>
    s.cards.find((c) => c.id === cardId),
  ) as CardRow | undefined;
  const updateCardLocal = useBoardStore((s) => s.updateCard);
  const isGuest = useIsGuest();
  const [pending, start] = useTransition();

  if (!card) return null;

  const currentCard = card;
  const value = toDate(currentCard.dueDate);

  function persist(next: Date | null) {
    const prev = {
      dueDate: currentCard.dueDate,
      dueComplete: currentCard.dueComplete,
      completedAt: currentCard.completedAt,
    };
    // Persist as noon UTC so the date doesn't shift across time zones.
    const dueDate = next
      ? new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate(), 12))
      : null;
    const patch = next
      ? { dueDate }
      : { dueDate: null, dueComplete: false };
    updateCardLocal(cardId, patch);
    start(async () => {
      try {
        await updateCard({ id: cardId, ...patch });
        undoBus.push({
          message: next ? "Due date updated" : "Due date cleared",
          undo: async () => {
            updateCardLocal(cardId, prev);
            try {
              await updateCard({
                id: cardId,
                dueDate: prev.dueDate,
                dueComplete: prev.dueComplete,
                completed: prev.completedAt != null || prev.dueComplete,
              });
            } catch (err) {
              updateCardLocal(cardId, patch);
              toast.error("Undo failed: " + (err as Error).message);
              throw err;
            }
          },
          redo: async () => {
            updateCardLocal(cardId, patch);
            try {
              await updateCard({ id: cardId, ...patch });
            } catch (err) {
              updateCardLocal(cardId, prev);
              toast.error("Redo failed: " + (err as Error).message);
              throw err;
            }
          },
        });
      } catch (err) {
        updateCardLocal(cardId, prev);
        toast.error((err as Error).message);
      }
    });
  }

  function toggleComplete(checked: boolean) {
    const prev = {
      dueComplete: currentCard.dueComplete,
      completedAt: currentCard.completedAt,
    };
    // Optimistic mirror — the DB trigger keeps both fields in sync, but
    // we update both locally so any subscriber that reads either flag
    // sees the change without waiting for realtime.
    updateCardLocal(cardId, {
      dueComplete: checked,
      completedAt: checked ? new Date() : null,
    });
    start(async () => {
      try {
        await updateCard({ id: cardId, completed: checked });
        undoBus.push({
          message: checked ? "Marked complete" : "Marked not complete",
          undo: async () => {
            updateCardLocal(cardId, prev);
            try {
              await updateCard({
                id: cardId,
                completed: prev.completedAt != null || prev.dueComplete,
              });
            } catch (err) {
              updateCardLocal(cardId, {
                dueComplete: checked,
                completedAt: checked ? new Date() : null,
              });
              toast.error("Undo failed: " + (err as Error).message);
              throw err;
            }
          },
          redo: async () => {
            updateCardLocal(cardId, {
              dueComplete: checked,
              completedAt: checked ? new Date() : null,
            });
            try {
              await updateCard({ id: cardId, completed: checked });
            } catch (err) {
              updateCardLocal(cardId, prev);
              toast.error("Redo failed: " + (err as Error).message);
              throw err;
            }
          },
        });
      } catch (err) {
        updateCardLocal(cardId, prev);
        toast.error((err as Error).message);
      }
    });
  }

  if (isGuest) {
    // Guests are read-only — render only the saved date, no controls.
    if (!value) return null;
    return (
      <section className="space-y-2" data-testid="due-section">
        <div className="flex items-baseline justify-between border-b border-hairline pb-1">
          <h3 className="mono-meta text-fg-muted">Due date</h3>
        </div>
        <p className="text-sm text-fg">
          {value.toLocaleDateString()}
          {currentCard.dueComplete ? " · complete" : ""}
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-2" data-testid="due-section">
      <div className="flex items-baseline justify-between border-b border-hairline pb-1">
        <h3 className="mono-meta text-fg-muted">Due date</h3>
        {pending && <span className="mono-meta-sm text-fg-faint">SAVING…</span>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <DatePicker
          value={value}
          onChange={persist}
          disabled={pending}
          triggerLabel="Set due date"
          inputLabel="Due date"
        />
        {currentCard.dueDate && (
          <label className="flex items-center gap-1.5 mono-meta text-fg/75">
            <input
              type="checkbox"
              checked={currentCard.dueComplete}
              onChange={(e) => toggleComplete(e.target.checked)}
              disabled={pending}
              className="size-3.5"
            />
            Mark complete
          </label>
        )}
      </div>
    </section>
  );
}
