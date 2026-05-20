"use client";
import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { updateCard } from "@/actions/cards";
import { undoBus } from "@/lib/undo-bus";
import { subtaskSyncBus } from "@/lib/subtask-sync-bus";

// One-click "mark complete" toggle, used everywhere a card surfaces in
// a list/row context (board tile, all-tasks, backlog, archive, etc.).
//
// The card modal and roadmap have their own larger affordances; this is
// the small inline ring + check meant to fit into a row of meta chips.

export function CompleteToggle({
  cardId,
  completed,
  onLocalChange,
  size = "sm",
  className = "",
}: {
  cardId: string;
  completed: boolean;
  /** Optional optimistic-update hook. Caller passes its store mutation. */
  onLocalChange?: (next: boolean) => void;
  size?: "xs" | "sm" | "md";
  className?: string;
}) {
  // Local mirror so the visual flips even when the parent doesn't pass
  // a store-updating callback (e.g. server-rendered backlog list with no
  // realtime subscription on this surface). Realtime / page revalidation
  // will eventually align this with persisted state.
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const [pending, start] = useTransition();
  const value = optimistic ?? completed;

  const dim =
    size === "xs"
      ? { box: "size-3.5", icon: "size-2 stroke-[3]" }
      : size === "md"
        ? { box: "size-5", icon: "size-3 stroke-[3]" }
        : { box: "size-4", icon: "size-2.5 stroke-[3]" };

  function toggle(e: React.MouseEvent | React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const next = !value;
    setOptimistic(next);
    onLocalChange?.(next);
    start(async () => {
      try {
        await updateCard({ id: cardId, completed: next });
        // Fires the board-mounted prompt if the toggled card is a
        // sub-task whose parent transition criteria are met. No-op
        // when no listener is mounted (off-board surfaces).
        subtaskSyncBus.emit({ cardId, completed: next });
        undoBus.push({
          message: next ? "Marked complete" : "Marked not complete",
          undo: async () => {
            setOptimistic(value);
            onLocalChange?.(value);
            try {
              await updateCard({ id: cardId, completed: value });
            } catch (err) {
              setOptimistic(next);
              onLocalChange?.(next);
              toast.error("Undo failed: " + (err as Error).message);
            }
          },
        });
      } catch (err) {
        setOptimistic(value);
        onLocalChange?.(value);
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      onPointerDown={(e) => {
        // dnd-kit's PointerSensor activates on pointerdown via the
        // wrapping Link's `{...listeners}`. Both stopPropagation and
        // preventDefault are needed: stop the React bubble + prevent
        // the native default that some sensors hook into.
        e.stopPropagation();
        e.preventDefault();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      disabled={pending}
      aria-label={value ? "Mark not complete" : "Mark complete"}
      aria-pressed={value}
      data-testid="complete-toggle"
      data-completed={value ? "true" : "false"}
      className={`shrink-0 ${dim.box} rounded-full border flex items-center justify-center transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40 ${
        value
          ? "bg-[color:var(--accent-lime)] border-[color:var(--accent-lime)] text-bg-deep"
          : "border-hairline-hi text-transparent hover:border-fg/60 hover:text-fg/40"
      } ${className}`}
    >
      <Check className={dim.icon} />
    </button>
  );
}
