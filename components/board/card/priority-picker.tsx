"use client";
import { useTransition } from "react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { updateCard } from "@/actions/cards";
import { useBoardStore } from "@/stores/board-store";
import { toast } from "sonner";
import { ChevronDown, Flag } from "lucide-react";
import { undoBus } from "@/lib/undo-bus";

export type CardPriority = "p0" | "p1" | "p2" | "p3" | "p4";

// Plan #16b-γ-C (#1) — priority colors break the monochrome rule.
// Acceptable per design: priority is semantic warning, like the
// blocked-status badge. Tints fade red→orange→yellow→neutral.
// DB enum values (p0..p4) are stable; only display labels change.
export const PRIORITY_LABELS: Record<CardPriority, string> = {
  p0: "Critical",
  p1: "High",
  p2: "Medium",
  p3: "Low",
  p4: "TBD",
};

export const PRIORITY_TINT: Record<
  CardPriority,
  {
    chip: string;
    dot: string;
    text: string;
    /** Raw RGB used for color-mix tinting of card surfaces. */
    surface: string;
    /** Raw RGB used where a Tailwind class can't apply (native <option>). */
    textColor: string;
  }
> = {
  p0: {
    chip: "bg-red-900/30 text-red-200 ring-1 ring-red-500/30",
    dot: "bg-red-400",
    text: "text-red-300",
    surface: "rgb(239 68 68)",
    textColor: "rgb(252 165 165)",
  },
  p1: {
    chip: "bg-orange-900/30 text-orange-200 ring-1 ring-orange-500/30",
    dot: "bg-orange-400",
    text: "text-orange-300",
    surface: "rgb(249 115 22)",
    textColor: "rgb(253 186 116)",
  },
  p2: {
    chip: "bg-yellow-900/30 text-yellow-200 ring-1 ring-yellow-500/30",
    dot: "bg-yellow-300",
    text: "text-yellow-200",
    surface: "rgb(234 179 8)",
    textColor: "rgb(254 240 138)",
  },
  p3: {
    chip: "bg-fg/8 text-fg-muted ring-1 ring-fg/15",
    dot: "bg-fg/50",
    text: "text-fg-muted",
    surface: "rgb(160 160 160)",
    textColor: "rgb(212 212 212)",
  },
  p4: {
    chip: "bg-fg/5 text-fg-faint ring-1 ring-fg/10",
    dot: "bg-fg/30",
    text: "text-fg-faint",
    surface: "rgb(120 120 120)",
    textColor: "rgb(163 163 163)",
  },
};

export function PriorityChip({ priority }: { priority: CardPriority }) {
  const tint = PRIORITY_TINT[priority];
  return (
    <span
      data-testid="tile-priority"
      data-priority={priority}
      className={`mono-meta-sm inline-flex items-center gap-1 rounded px-1.5 py-0.5 tabular-nums ${tint.chip}`}
      title={PRIORITY_LABELS[priority]}
    >
      <span className={`size-1.5 rounded-full ${tint.dot}`} aria-hidden />
      {PRIORITY_LABELS[priority].toUpperCase()}
    </span>
  );
}

const PRIORITIES: CardPriority[] = ["p0", "p1", "p2", "p3", "p4"];

export function PriorityPicker({
  cardId,
  priority,
}: {
  cardId: string;
  priority: CardPriority | null;
}) {
  const updateCardLocal = useBoardStore((s) => s.updateCard);
  const [pending, start] = useTransition();

  function set(next: CardPriority | null) {
    if (next === priority) return;
    const prev = priority;
    updateCardLocal(cardId, { priority: next });
    start(async () => {
      try {
        await updateCard({ id: cardId, priority: next });
        undoBus.push({
          message: next ? `Priority ${PRIORITY_LABELS[next]}` : "Priority cleared",
          undo: async () => {
            updateCardLocal(cardId, { priority: prev });
            try {
              await updateCard({ id: cardId, priority: prev });
            } catch (err) {
              updateCardLocal(cardId, { priority: next });
              toast.error("Undo failed: " + (err as Error).message);
            }
          },
        });
      } catch (err) {
        updateCardLocal(cardId, { priority: prev });
        toast.error((err as Error).message);
      }
    });
  }

  const triggerLabel = priority
    ? PRIORITY_LABELS[priority].toUpperCase()
    : "PRIORITY";
  const triggerTint = priority
    ? PRIORITY_TINT[priority].chip
    : "hover:bg-[rgb(255_255_255/0.08)]";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid="card-priority-picker"
        data-priority={priority ?? "none"}
        className={`chip inline-flex items-center gap-1.5 transition-colors ${triggerTint}`}
        disabled={pending}
      >
        <Flag className="size-3" />
        <span>{triggerLabel}</span>
        <ChevronDown className="size-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuRadioGroup
          value={priority ?? ""}
          onValueChange={(v) => set(v as CardPriority)}
        >
          {PRIORITIES.map((p) => (
            <DropdownMenuRadioItem
              key={p}
              value={p}
              className={`gap-2 ${PRIORITY_TINT[p].text}`}
            >
              <span
                aria-hidden
                className={`size-2 rounded-full ${PRIORITY_TINT[p].dot}`}
              />
              {PRIORITY_LABELS[p]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {priority !== null && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => set(null)}
              className="text-fg-muted"
            >
              Clear priority
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
