"use client";
import { useTransition } from "react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuRadioGroup, DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { updateCard } from "@/actions/cards";
import { useBoardStore } from "@/stores/board-store";
import { toast } from "sonner";
import {
  Mountain, BookOpen, Square, CheckSquare, Bug, ChevronDown,
} from "lucide-react";

const TYPES = [
  { id: "epic",    label: "Epic",     Icon: Mountain     },
  { id: "story",   label: "Story",    Icon: BookOpen     },
  { id: "task",    label: "Task",     Icon: Square       },
  { id: "subtask", label: "Sub-task", Icon: CheckSquare  },
  { id: "bug",     label: "Bug",      Icon: Bug          },
] as const;

export type CardType = typeof TYPES[number]["id"];

export function TypeIcon({ type, className }: { type: string; className?: string }) {
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
    updateCardLocal(cardId, { type: next });
    start(async () => {
      try { await updateCard({ id: cardId, type: next }); }
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
          {TYPES.map((t) => (
            <DropdownMenuRadioItem key={t.id} value={t.id} className="gap-2">
              <t.Icon className="size-3.5" /> {t.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
