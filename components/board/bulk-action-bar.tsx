"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Archive,
  ArrowRight,
  Layers3,
  Tag,
  Users,
  X,
  Component as ComponentIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { useBoardStore } from "@/stores/board-store";
import { positionBetween } from "@/lib/ordering";
import {
  bulkArchiveCards,
  bulkSetSprint,
  bulkAddLabel,
  moveCard,
} from "@/actions/cards";
import { toggleCardMember } from "@/actions/card-members";
import { toggleCardComponent } from "@/actions/card-components";
import { undoBus } from "@/lib/undo-bus";
import { errorBus } from "@/lib/errors/error-bus";
import type { SprintLite } from "@/components/sprint/sprint-picker";

const BULK_LIMIT = 50;

/**
 * Plan #16b-γ-D (#8) — bulk action bar.
 *
 * Slides up from the bottom of the board view when one or more cards
 * are selected. Each action calls the matching server action — bulk
 * impl where it exists, else a Promise.all loop over the selected ids.
 * Cancel clears the selection. Archive pushes an undo banner so the
 * user can revert.
 *
 * Esc also clears the selection (handled here at window level so it
 * works regardless of which tile has focus).
 */
export function BulkActionBar({
  sprints,
}: {
  sprints: SprintLite[];
}) {
  const router = useRouter();
  const selectedIds = useBoardStore((s) => Array.from(s.selectedCardIds));
  const lists = useBoardStore((s) => s.lists);
  const labels = useBoardStore((s) => s.labels);
  const components = useBoardStore((s) => s.components);
  const profiles = useBoardStore((s) => s.boardProfiles);
  const cards = useBoardStore((s) => s.cards);
  const clearSelection = useBoardStore((s) => s.clearSelection);
  const moveCardLocal = useBoardStore((s) => s.moveCard);
  const [pending, start] = useTransition();

  // Esc clears selection.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && selectedIds.length > 0) {
        clearSelection();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedIds.length, clearSelection]);

  const count = selectedIds.length;
  const overLimit = count > BULK_LIMIT;
  const buttonsDisabled = pending || count === 0 || overLimit;

  const canBulk = useMemo(() => selectedIds.slice(0, BULK_LIMIT), [selectedIds]);

  if (count === 0) return null;

  function pushError(msg: string) {
    toast.error(msg);
    errorBus.push({ message: msg });
  }

  function onArchive() {
    const ids = canBulk;
    start(async () => {
      try {
        await bulkArchiveCards({ cardIds: ids, archived: true });
        clearSelection();
        undoBus.push({
          message: `Archived ${ids.length} card${ids.length === 1 ? "" : "s"}`,
          undo: async () => {
            try {
              await bulkArchiveCards({ cardIds: ids, archived: false });
            } catch (err) {
              pushError("Undo failed: " + (err as Error).message);
            }
          },
        });
        router.refresh();
      } catch (err) {
        pushError("Bulk archive failed: " + (err as Error).message);
      }
    });
  }

  function onMoveToList(toListId: string) {
    const ids = canBulk;
    // Snapshot original positions for undo.
    const originals = ids
      .map((id) => cards.find((c) => c.id === id))
      .filter((c): c is NonNullable<typeof c> => !!c)
      .map((c) => ({ id: c.id, listId: c.listId, position: c.position }));
    // Build positions appended at the end of the target list.
    const targetCards = cards.filter((c) => c.listId === toListId).slice();
    let prev =
      targetCards.length > 0
        ? targetCards.sort((a, b) => (a.position < b.position ? -1 : 1))[
            targetCards.length - 1
          ].position
        : null;
    const newPositions: { id: string; position: string }[] = [];
    for (const id of ids) {
      const pos = positionBetween(prev, null);
      newPositions.push({ id, position: pos });
      prev = pos;
    }
    start(async () => {
      try {
        await Promise.all(
          newPositions.map((np) =>
            moveCard({ id: np.id, listId: toListId, position: np.position }),
          ),
        );
        for (const np of newPositions) {
          moveCardLocal(np.id, toListId, np.position);
        }
        clearSelection();
        undoBus.push({
          message: `Moved ${ids.length} card${ids.length === 1 ? "" : "s"}`,
          undo: async () => {
            try {
              await Promise.all(
                originals.map((o) =>
                  moveCard({ id: o.id, listId: o.listId, position: o.position }),
                ),
              );
              for (const o of originals) {
                moveCardLocal(o.id, o.listId, o.position);
              }
            } catch (err) {
              pushError("Undo failed: " + (err as Error).message);
            }
          },
        });
      } catch (err) {
        pushError("Bulk move failed: " + (err as Error).message);
        router.refresh();
      }
    });
  }

  function onAddLabel(labelId: string) {
    const ids = canBulk;
    start(async () => {
      try {
        await bulkAddLabel({ cardIds: ids, labelId });
        clearSelection();
        toast.success(
          `Labeled ${ids.length} card${ids.length === 1 ? "" : "s"}`,
        );
        router.refresh();
      } catch (err) {
        pushError("Bulk label failed: " + (err as Error).message);
      }
    });
  }

  function onAssignMember(userId: string) {
    const ids = canBulk;
    start(async () => {
      try {
        // `toggleCardMember` flips; for bulk we accept it might unassign
        // already-assigned cards. The dropdown reads "Toggle member" so
        // the UX is honest — full assign-only would need a new endpoint.
        await Promise.all(
          ids.map((cardId) => toggleCardMember({ cardId, userId })),
        );
        clearSelection();
        toast.success(
          `Toggled member on ${ids.length} card${
            ids.length === 1 ? "" : "s"
          }`,
        );
        router.refresh();
      } catch (err) {
        pushError("Bulk assign failed: " + (err as Error).message);
      }
    });
  }

  function onSetSprint(sprintId: string | null) {
    const ids = canBulk;
    start(async () => {
      try {
        await bulkSetSprint({ cardIds: ids, sprintId });
        clearSelection();
        toast.success(
          `Sprint updated on ${ids.length} card${ids.length === 1 ? "" : "s"}`,
        );
        router.refresh();
      } catch (err) {
        pushError("Bulk sprint failed: " + (err as Error).message);
      }
    });
  }

  function onAddComponent(componentId: string) {
    const ids = canBulk;
    start(async () => {
      try {
        await Promise.all(
          ids.map((cardId) =>
            toggleCardComponent({ cardId, componentId }),
          ),
        );
        clearSelection();
        toast.success(
          `Component toggled on ${ids.length} card${
            ids.length === 1 ? "" : "s"
          }`,
        );
        router.refresh();
      } catch (err) {
        pushError("Bulk component failed: " + (err as Error).message);
      }
    });
  }

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-3xl px-3 pb-3 pointer-events-none"
      data-testid="bulk-action-bar"
    >
      <div className="pointer-events-auto flex items-center gap-2 rounded-2xl border border-[color:var(--hairline-hi)] bg-[color:var(--surface-strong)] backdrop-blur-md px-3 py-2 text-sm text-fg shadow-xl animate-in fade-in slide-in-from-bottom-2 duration-200">
        <span
          className="chip mono-meta-sm"
          data-testid="bulk-action-bar-count"
        >
          {count} SELECTED
          {overLimit ? ` · capped at ${BULK_LIMIT}` : ""}
        </span>

        {/* Move to list */}
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={buttonsDisabled}
            className="chip mono-meta-sm inline-flex items-center gap-1 hover:bg-[rgb(255_255_255/0.08)]"
          >
            <ArrowRight className="size-3" />
            MOVE
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>To list</DropdownMenuLabel>
            {lists.map((l) => (
              <DropdownMenuItem
                key={l.id}
                onClick={() => onMoveToList(l.id)}
              >
                {l.title}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Add label */}
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={buttonsDisabled || labels.length === 0}
            className="chip mono-meta-sm inline-flex items-center gap-1 hover:bg-[rgb(255_255_255/0.08)] disabled:opacity-50"
          >
            <Tag className="size-3" />
            LABEL
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Add label</DropdownMenuLabel>
            {labels.map((l) => (
              <DropdownMenuItem key={l.id} onClick={() => onAddLabel(l.id)}>
                <span
                  aria-hidden
                  className="size-2 rounded-full mr-2"
                  style={{ backgroundColor: l.color }}
                />
                {l.name || l.color}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Assign member */}
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={buttonsDisabled || profiles.length === 0}
            className="chip mono-meta-sm inline-flex items-center gap-1 hover:bg-[rgb(255_255_255/0.08)] disabled:opacity-50"
          >
            <Users className="size-3" />
            ASSIGN
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Toggle member</DropdownMenuLabel>
            {profiles.map((p) => (
              <DropdownMenuItem
                key={p.id}
                onClick={() => onAssignMember(p.id)}
              >
                {p.displayName}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Sprint */}
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={buttonsDisabled}
            className="chip mono-meta-sm inline-flex items-center gap-1 hover:bg-[rgb(255_255_255/0.08)] disabled:opacity-50"
          >
            <Layers3 className="size-3" />
            SPRINT
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Set sprint</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => onSetSprint(null)}>
              Backlog (clear)
            </DropdownMenuItem>
            {sprints.map((s) => (
              <DropdownMenuItem key={s.id} onClick={() => onSetSprint(s.id)}>
                {s.name}{" "}
                <span className="ml-auto mono-meta-sm text-fg-faint">
                  {s.state}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Component */}
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={buttonsDisabled || components.length === 0}
            className="chip mono-meta-sm inline-flex items-center gap-1 hover:bg-[rgb(255_255_255/0.08)] disabled:opacity-50"
          >
            <ComponentIcon className="size-3" />
            COMPONENT
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Toggle component</DropdownMenuLabel>
            {components.map((c) => (
              <DropdownMenuItem
                key={c.id}
                onClick={() => onAddComponent(c.id)}
              >
                {c.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Archive */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={buttonsDisabled}
          onClick={onArchive}
          data-testid="bulk-action-archive"
        >
          <Archive className="size-3.5 mr-1" />
          Archive
        </Button>

        {/* Cancel */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => clearSelection()}
          data-testid="bulk-action-cancel"
        >
          <X className="size-3.5" />
          Cancel
        </Button>
      </div>
    </div>
  );
}
