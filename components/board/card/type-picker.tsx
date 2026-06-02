"use client";
import { useTransition } from "react";
import { toast } from "sonner";
import { useStore } from "zustand";
import { useContext } from "react";
import { Square, CheckSquare, Bug, Layers3 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { updateCard } from "@/actions/cards";
import { useIsGuest } from "@/lib/permissions/use-is-guest";
import { BoardStoreContext } from "@/stores/board-store";

// User-selectable types after the 2026-05-18 retire pass:
//   Story removed (label-only legacy display when a card still has it)
//   Subtask removed from picker (existing subtask cards keep their chip)
//   sub-board lives on boards.parent_card_id, not cards.type
type EditableType = "task" | "bug";
const TYPES: ReadonlyArray<{
  id: EditableType;
  label: string;
  Icon?: typeof Square;
}> = [
  { id: "task", label: "Task", Icon: Square },
  { id: "bug",  label: "Bug",  Icon: Bug },
];
// Legacy types — render the chip when a card already has one of these,
// but do not offer them in the picker. Users flip OUT of legacy, not IN.
const LEGACY_TYPES: Record<
  string,
  { label: string; Icon?: typeof Square }
> = {
  story:             { label: "Story" },
  subtask:           { label: "Subtask",   Icon: CheckSquare },
  "legacy-subboard": { label: "Sub-board", Icon: Layers3 },
};

export function TypeIcon({ type, className }: { type: string; className?: string }) {
  // 'task' default — hollow Square reads as a checkbox not a type marker.
  if (type === "task") return null;
  const cur =
    TYPES.find((x) => x.id === type) ?? LEGACY_TYPES[type] ?? LEGACY_TYPES["legacy-subboard"];
  if (!cur.Icon) return null;
  return <cur.Icon className={className ?? "size-3.5"} aria-label={cur.label} />;
}

export function TypePicker({
  cardId,
  type,
}: {
  cardId?: string;
  type: string;
  parentCardId?: string | null;
}) {
  const isGuest = useIsGuest();
  const editable = !!cardId && !isGuest;
  const cur =
    TYPES.find((x) => x.id === type) ??
    (LEGACY_TYPES[type]
      ? { id: type, label: LEGACY_TYPES[type].label, Icon: LEGACY_TYPES[type].Icon }
      : { id: type, label: type, Icon: Layers3 });
  const isLegacy = !TYPES.some((x) => x.id === type);
  const boardStore = useContext(BoardStoreContext);
  const updateCardLocal = useStore(
    boardStore!,
    (s) => s.updateCard,
  );
  const [pending, start] = useTransition();
  const change = (next: EditableType) => {
    if (!cardId || next === type) return;
    start(async () => {
      try {
        await updateCard({ id: cardId, type: next });
        updateCardLocal(cardId, { type: next });
        toast.success(`Type set to ${next}`);
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  };

  const chipClass = [
    "chip inline-flex items-center gap-1.5",
    editable ? "cursor-pointer hover:bg-[rgb(255_255_255/0.08)]" : "cursor-default",
    pending ? "opacity-60" : "",
  ].join(" ");
  const content = (
    <>
      {cur.Icon && <cur.Icon className="size-3.5" />}
      <span>{cur.label.toUpperCase()}</span>
    </>
  );

  if (!editable) {
    return (
      <span
        className={chipClass}
        aria-label={`Type: ${cur.label}`}
        data-testid="card-type-display"
      >
        {content}
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={chipClass}
        aria-label={`Change type from ${cur.label}`}
        title={isLegacy ? `Legacy type (${cur.label}). Pick a current type to convert.` : "Change type"}
        disabled={pending}
        data-testid="card-type-edit"
      >
        {content}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {TYPES.map((opt) => (
          <DropdownMenuItem
            key={opt.id}
            onSelect={() => change(opt.id)}
            data-testid={`card-type-option-${opt.id}`}
          >
            {opt.Icon ? <opt.Icon className="size-3.5 mr-2" /> : <span className="size-3.5 mr-2" />}
            {opt.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
