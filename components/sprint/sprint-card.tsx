"use client";
import { useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { startSprint, deleteSprint } from "@/actions/sprints";
import { CompleteSprintDialog } from "./complete-sprint-dialog";
import { SprintPicker, type SprintLite } from "./sprint-picker";
import { Play, Trash2 } from "lucide-react";
import { toast } from "sonner";

export type SprintCardProps = {
  sprint: {
    id: string;
    name: string;
    goal: string | null;
    state: "planned" | "active" | "completed";
    startDate: Date | null;
    endDate: Date | null;
  };
  cards: Array<{
    id: string;
    title: string;
    boardId: string;
    boardTitle: string;
    sprintId: string | null;
  }>;
  allSprints: SprintLite[];
  workspaceId: string;
  activeExists?: boolean;
};

export function SprintCard({
  sprint,
  cards,
  allSprints,
  activeExists,
}: SprintCardProps) {
  const [pending, start] = useTransition();

  function onStart() {
    start(async () => {
      try {
        await startSprint({ id: sprint.id });
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  function onDelete() {
    if (!confirm("Delete this sprint? Cards in it will move to the backlog."))
      return;
    start(async () => {
      try {
        await deleteSprint({ id: sprint.id });
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  const isActive = sprint.state === "active";

  return (
    <div
      className={`glass rounded-2xl ${isActive ? "ring-1 ring-fg/40" : ""}`}
      data-testid={`sprint-card-${sprint.id}`}
    >
      <header className="flex items-start justify-between gap-3 p-4 border-b border-hairline">
        <div className="space-y-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <h3 className="serif-display text-2xl text-fg">{sprint.name}</h3>
            <span className="chip">{sprint.state.toUpperCase()}</span>
          </div>
          {sprint.goal && (
            <p className="text-sm text-fg-muted italic">
              &ldquo;{sprint.goal}&rdquo;
            </p>
          )}
          {(sprint.startDate || sprint.endDate) && (
            <p className="mono-meta-sm text-fg-faint">
              {sprint.startDate
                ? new Date(sprint.startDate).toLocaleDateString()
                : "?"}
              {" → "}
              {sprint.endDate
                ? new Date(sprint.endDate).toLocaleDateString()
                : "?"}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {sprint.state === "planned" && (
            <Button
              size="xs"
              onClick={onStart}
              disabled={pending || activeExists}
            >
              <Play className="size-3 mr-1" /> START
            </Button>
          )}
          {isActive && (
            <CompleteSprintDialog
              sprintId={sprint.id}
              otherSprints={allSprints.filter(
                (s) => s.id !== sprint.id && s.state === "planned",
              )}
            />
          )}
          {sprint.state !== "active" && (
            <Button
              size="xs"
              variant="ghost"
              onClick={onDelete}
              disabled={pending}
              aria-label="Delete sprint"
            >
              <Trash2 className="size-3" />
            </Button>
          )}
        </div>
      </header>
      <ul className="divide-y divide-hairline">
        {cards.length === 0 && (
          <li className="px-4 py-6 text-sm text-fg-faint italic text-center">
            No cards yet. Move cards in from the backlog using the sprint
            dropdown.
          </li>
        )}
        {cards.map((c) => (
          <li
            key={c.id}
            className="flex items-center gap-3 px-4 py-2"
          >
            <Link
              href={`/b/${c.boardId}/c/${c.id}`}
              className="flex-1 min-w-0 truncate hover:underline text-sm"
            >
              {c.title}
            </Link>
            <span className="mono-meta-sm text-fg-faint hidden sm:inline">
              {c.boardTitle}
            </span>
            <SprintPicker
              cardId={c.id}
              sprintId={c.sprintId ?? null}
              sprints={allSprints}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
