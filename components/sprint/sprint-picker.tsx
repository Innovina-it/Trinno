"use client";
import { useTransition } from "react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Calendar } from "lucide-react";
import { assignCardToSprint } from "@/actions/sprints";
import { toast } from "sonner";

export type SprintLite = {
  id: string;
  name: string;
  state: "planned" | "active" | "completed";
};

export function SprintPicker({
  cardId,
  sprintId,
  sprints,
}: {
  cardId: string;
  sprintId: string | null;
  sprints: SprintLite[];
}) {
  const [pending, start] = useTransition();
  const current = sprints.find((s) => s.id === sprintId);
  const label = current ? current.name : "Backlog";

  function set(next: string | null) {
    if (next === sprintId) return;
    start(async () => {
      try {
        await assignCardToSprint({ cardId, sprintId: next });
      } catch (err) {
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
        <Calendar className="size-3" />
        <span className="truncate max-w-[10rem]">{label.toUpperCase()}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuRadioGroup
          value={sprintId ?? "backlog"}
          onValueChange={(v) => set(v === "backlog" ? null : v)}
        >
          <DropdownMenuRadioItem value="backlog">Backlog</DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          {sprints
            .filter((s) => s.state !== "completed")
            .map((s) => (
              <DropdownMenuRadioItem key={s.id} value={s.id}>
                {s.name}{" "}
                <span className="ml-2 mono-meta-sm text-fg-faint">
                  {s.state.toUpperCase()}
                </span>
              </DropdownMenuRadioItem>
            ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
