"use client";
import { useTransition } from "react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuRadioGroup, DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { updateCard } from "@/actions/cards";
import { useBoardStore } from "@/stores/board-store";
import { toast } from "sonner";
import { undoBus } from "@/lib/undo-bus";
import {
  Mountain, BookOpen, Square, CheckSquare, Bug, ChevronDown,
} from "lucide-react";

// Story kept here for visual-only resolution of legacy cards (TypeIcon
// still maps type='story' to BookOpen). Excluded from PICKABLE_TYPES so
// it never appears in the dropdown.
const TYPES = [
  { id: "epic",    label: "Epic",     Icon: Mountain     },
  { id: "story",   label: "Story",    Icon: BookOpen     },
  { id: "task",    label: "Task",     Icon: Square       },
  { id: "subtask", label: "Sub-task", Icon: CheckSquare  },
  { id: "bug",     label: "Bug",      Icon: Bug          },
] as const;

const PICKABLE_TYPES = TYPES.filter((t) => t.id !== "story");

export type CardType = typeof TYPES[number]["id"];

export function TypeIcon({ type, className }: { type: string; className?: string }) {
  // 'task' is the default type for most cards; the hollow Square glyph
  // reads as a clickable checkbox, not a type marker.  Drop the icon
  // for that path — absence of an icon == "task" by convention.  Other
  // types keep their distinctive glyphs.
  if (type === "task") return null;
  const t = TYPES.find((x) => x.id === type) ?? TYPES[2];
  return <t.Icon className={className ?? "size-3.5"} aria-label={t.label} />;
}

export function TypePicker({ cardId, type, parentCardId }: { cardId: string; type: string; parentCardId: string | null }) {
  const updateCardLocal = useBoardStore((s) => s.updateCard);
  const [pending, start] = useTransition();
  const current = TYPES.find((x) => x.id === type) ?? TYPES[2];

  function set(next: CardType) {
    if (next === type) return;
    if (next === "subtask" && !parentCardId) {
      toast.error("Pick a parent first to make this a sub-task.");
      return;
    }
    const prev = type as CardType;
    updateCardLocal(cardId, { type: next });
    start(async () => {
      try {
        await updateCard({ id: cardId, type: next });
        undoBus.push({
          message: "Card type updated",
          undo: async () => {
            updateCardLocal(cardId, { type: prev });
            try {
              await updateCard({ id: cardId, type: prev });
            } catch (err) {
              updateCardLocal(cardId, { type: next });
              toast.error("Undo failed: " + (err as Error).message);
            }
          },
        });
      }
      catch (err) {
        updateCardLocal(cardId, { type });
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="chip inline-flex items-center gap-1.5 hover:bg-[rgb(255_255_255/0.08)] transition-colors"
        disabled={pending}
      >
        <current.Icon className="size-3.5" />
        <span>{current.label.toUpperCase()}</span>
        <ChevronDown className="size-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuRadioGroup value={type} onValueChange={(v) => set(v as CardType)}>
          {PICKABLE_TYPES.map((t) => (
            <DropdownMenuRadioItem key={t.id} value={t.id} className="gap-2">
              <t.Icon className="size-3.5" /> {t.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
