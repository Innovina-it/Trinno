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

export type CardPriority = "p0" | "p1" | "p2" | "p3" | "p4";

// Plan #16b-γ-C (#1) — priority colors break the monochrome rule.
// Acceptable per design: priority is semantic warning, like the
// blocked-status badge. Tints fade red→orange→yellow→neutral.
const PRIORITY_LABELS: Record<CardPriority, string> = {
  p0: "P0 — Critical",
  p1: "P1 — High",
  p2: "P2 — Medium",
  p3: "P3 — Low",
  p4: "P4 — Trivial",
};

export const PRIORITY_TINT: Record<
  CardPriority,
  { chip: string; dot: string }
> = {
  p0: {
    chip: "bg-red-900/30 text-red-200 ring-1 ring-red-500/30",
    dot: "bg-red-400",
  },
  p1: {
    chip: "bg-orange-900/30 text-orange-200 ring-1 ring-orange-500/30",
    dot: "bg-orange-400",
  },
  p2: {
    chip: "bg-yellow-900/30 text-yellow-200 ring-1 ring-yellow-500/30",
    dot: "bg-yellow-300",
  },
  p3: {
    chip: "bg-fg/8 text-fg-muted ring-1 ring-fg/15",
    dot: "bg-fg/50",
  },
  p4: {
    chip: "bg-fg/5 text-fg-faint ring-1 ring-fg/10",
    dot: "bg-fg/30",
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
      {priority.toUpperCase()}
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
      } catch (err) {
        updateCardLocal(cardId, { priority: prev });
        toast.error((err as Error).message);
      }
    });
  }

  const triggerLabel = priority ? priority.toUpperCase() : "PRIORITY";
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
            <DropdownMenuRadioItem key={p} value={p} className="gap-2">
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
