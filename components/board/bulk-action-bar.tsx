"use client";
import { useEffect, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Archive,
  ArrowRight,
  Check,
  Flag,
  Layers3,
  Minus,
  MoreHorizontal,
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
  DropdownMenuGroup,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { useBoardStore } from "@/stores/board-store";
import { useIsGuest } from "@/lib/permissions/use-is-guest";
import { positionBetween } from "@/lib/ordering";
import {
  bulkArchiveCards,
  bulkSetSprint,
  bulkAddLabel,
  bulkSetPriority,
  bulkSetCompleted,
} from "@/actions/cards";
import { moveCardToList } from "@/actions/lists";
import {
  PRIORITY_LABELS,
  PRIORITY_TINT,
  type CardPriority,
} from "@/components/board/card/priority-picker";
import { toggleCardLabel } from "@/actions/labels";
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
  const isGuest = useIsGuest();
  // Select the Set reference (stable per mutation) and derive the array
  // in useMemo so we don't trigger React 19's "selector returned a new
  // value each render" guard.
  const selectedIdSet = useBoardStore((s) => s.selectedCardIds);
  const selectedIds = useMemo(
    () => Array.from(selectedIdSet),
    [selectedIdSet],
  );
  const lists = useBoardStore((s) => s.lists);
  const labels = useBoardStore((s) => s.labels);
  const cardLabels = useBoardStore((s) => s.cardLabels);
  const components = useBoardStore((s) => s.components);
  const cardComponents = useBoardStore((s) => s.cardComponents);
  const profiles = useBoardStore((s) => s.boardProfiles);
  const cardMembers = useBoardStore((s) => s.cardMembers);
  const cards = useBoardStore((s) => s.cards);
  const clearSelection = useBoardStore((s) => s.clearSelection);
  const moveCardLocal = useBoardStore((s) => s.moveCard);
  const updateCardLocal = useBoardStore((s) => s.updateCard);
  const addCardLocal = useBoardStore((s) => s.addCard);
  const removeCardLocal = useBoardStore((s) => s.removeCard);
  const addCardLabelLocal = useBoardStore((s) => s.addCardLabel);
  const removeCardLabelLocal = useBoardStore((s) => s.removeCardLabel);
  const addCardMemberLocal = useBoardStore((s) => s.addCardMember);
  const removeCardMemberLocal = useBoardStore((s) => s.removeCardMember);
  const addCardComponentLocal = useBoardStore((s) => s.addCardComponent);
  const removeCardComponentLocal = useBoardStore((s) => s.removeCardComponent);
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
  const memberAssignmentCounts = useMemo(() => {
    const selected = new Set(canBulk);
    const counts = new Map<string, number>();
    for (const m of cardMembers) {
      if (!selected.has(m.cardId)) continue;
      counts.set(m.userId, (counts.get(m.userId) ?? 0) + 1);
    }
    return counts;
  }, [canBulk, cardMembers]);

  if (count === 0) return null;
  // #0111 — guests have no bulk actions; selection handles are hidden
  // on the tile, but defense-in-depth: bail here too.
  if (isGuest) return null;

  function pushError(msg: string) {
    toast.error(msg);
    errorBus.push({ message: msg });
  }

  function onMarkCompleted() {
    const ids = canBulk;
    // Snapshot prior completedAt so we can rollback or undo. Only cards
    // that were NOT already complete get flipped to "now"; the rest are
    // left alone server-side (they receive the same timestamp but the
    // DB trigger no-ops on identical values) and ignored on undo.
    const prior = ids.map((id) => {
      const c = cards.find((x) => x.id === id);
      return {
        id,
        completedAt:
          (c as { completedAt?: Date | string | null } | undefined)
            ?.completedAt ?? null,
      };
    });
    const wasIncompleteIds = prior
      .filter((p) => p.completedAt == null)
      .map((p) => p.id);
    const stamp = new Date();
    // Optimistic local update: stamp completedAt so tiles repaint
    // immediately. dueComplete is mirrored by the DB trigger; the next
    // server snapshot will sync that field locally too.
    for (const id of wasIncompleteIds) {
      updateCardLocal(id, { completedAt: stamp });
    }
    // Already-complete count: cards whose completedAt was non-null
    // before this bulk action. Surfaced in the toast so users
    // understand that "Completed N" doesn't always mean N transitions.
    const alreadyCompleteCount = ids.length - wasIncompleteIds.length;
    start(async () => {
      try {
        await bulkSetCompleted({ cardIds: ids, completed: true });
        clearSelection();
        const baseMsg = `Completed ${ids.length} card${ids.length === 1 ? "" : "s"}`;
        toast.success(
          alreadyCompleteCount > 0
            ? `${baseMsg} (${alreadyCompleteCount} ${alreadyCompleteCount === 1 ? "was" : "were"} already complete)`
            : baseMsg,
        );
        if (wasIncompleteIds.length > 0) {
          undoBus.push({
            message: `Completed ${wasIncompleteIds.length} card${
              wasIncompleteIds.length === 1 ? "" : "s"
            }`,
            undo: async () => {
              for (const id of wasIncompleteIds) {
                updateCardLocal(id, { completedAt: null });
              }
              try {
                await bulkSetCompleted({
                  cardIds: wasIncompleteIds,
                  completed: false,
                });
              } catch (err) {
                for (const id of wasIncompleteIds) {
                  updateCardLocal(id, { completedAt: stamp });
                }
                pushError("Undo failed: " + (err as Error).message);
              }
            },
          });
        }
      } catch (err) {
        // Rollback optimistic update on failure.
        for (const p of prior) {
          updateCardLocal(p.id, {
            completedAt:
              p.completedAt instanceof Date
                ? p.completedAt
                : p.completedAt
                  ? new Date(p.completedAt)
                  : null,
          });
        }
        pushError("Bulk complete failed: " + (err as Error).message);
      }
    });
  }

  function onArchive() {
    const ids = canBulk;
    // instant-feedback B1 — snapshot full rows so tiles vanish locally
    // (no router.refresh blink) and undo can re-add them in place.
    const rows = ids
      .map((id) => cards.find((c) => c.id === id))
      .filter((c): c is NonNullable<typeof c> => !!c);
    for (const id of ids) removeCardLocal(id);
    start(async () => {
      try {
        await bulkArchiveCards({ cardIds: ids, archived: true });
        clearSelection();
        undoBus.push({
          message: `Archived ${ids.length} card${ids.length === 1 ? "" : "s"}`,
          undo: async () => {
            for (const row of rows) addCardLocal(row);
            try {
              await bulkArchiveCards({ cardIds: ids, archived: false });
            } catch (err) {
              for (const id of ids) removeCardLocal(id);
              pushError("Undo failed: " + (err as Error).message);
              throw err;
            }
          },
          redo: async () => {
            for (const id of ids) removeCardLocal(id);
            try {
              await bulkArchiveCards({ cardIds: ids, archived: true });
            } catch (err) {
              for (const row of rows) addCardLocal(row);
              pushError("Redo failed: " + (err as Error).message);
              throw err;
            }
          },
        });
      } catch (err) {
        for (const row of rows) addCardLocal(row);
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
            moveCardToList({
              cardId: np.id,
              toListId,
              position: np.position,
            }),
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
                  moveCardToList({
                    cardId: o.id,
                    toListId: o.listId,
                    position: o.position,
                  }),
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
        // Partial multi-card moves can leave server and store divergent —
        // a full refresh is the honest recovery on this failure path.
        router.refresh();
      }
    });
  }

  function onAddLabel(labelId: string) {
    const ids = canBulk;
    const alreadyLabeled = new Set(
      cardLabels
        .filter((cl) => cl.labelId === labelId && ids.includes(cl.cardId))
        .map((cl) => cl.cardId),
    );
    const addedIds = ids.filter((id) => !alreadyLabeled.has(id));
    start(async () => {
      try {
        await bulkAddLabel({ cardIds: ids, labelId });
        for (const cardId of addedIds) addCardLabelLocal({ cardId, labelId });
        clearSelection();
        const labelName =
          labels.find((l) => l.id === labelId)?.name || "label";
        toast.success(
          `Labeled ${ids.length} card${ids.length === 1 ? "" : "s"}`,
        );
        if (addedIds.length > 0) {
          undoBus.push({
            message: `Added ${labelName} to ${addedIds.length} card${
              addedIds.length === 1 ? "" : "s"
            }`,
            undo: async () => {
              for (const cardId of addedIds) {
                removeCardLabelLocal(cardId, labelId);
              }
              try {
                await Promise.all(
                  addedIds.map((cardId) =>
                    toggleCardLabel({ cardId, labelId }),
                  ),
                );
              } catch (err) {
                for (const cardId of addedIds) {
                  addCardLabelLocal({ cardId, labelId });
                }
                pushError("Undo failed: " + (err as Error).message);
              }
            },
          });
        }
      } catch (err) {
        for (const cardId of addedIds) removeCardLabelLocal(cardId, labelId);
        pushError("Bulk label failed: " + (err as Error).message);
      }
    });
  }

  function onAssignMember(userId: string) {
    const ids = canBulk;
    const assignedIds = new Set(
      cardMembers
        .filter((m) => m.userId === userId && ids.includes(m.cardId))
        .map((m) => m.cardId),
    );
    const shouldUnassign = assignedIds.size === ids.length;
    const targetIds = shouldUnassign
      ? ids
      : ids.filter((id) => !assignedIds.has(id));
    if (targetIds.length === 0) return;

    if (shouldUnassign) {
      for (const cardId of targetIds) removeCardMemberLocal(cardId, userId);
    } else {
      for (const cardId of targetIds) {
        addCardMemberLocal({ cardId, userId });
      }
    }

    start(async () => {
      try {
        await Promise.all(
          targetIds.map((cardId) => toggleCardMember({ cardId, userId })),
        );
        clearSelection();
        const person =
          profiles.find((p) => p.id === userId)?.displayName ?? "Member";
        toast.success(
          shouldUnassign
            ? `Unassigned ${person} from ${targetIds.length} card${
                targetIds.length === 1 ? "" : "s"
              }`
            : `Assigned ${person} to ${targetIds.length} card${
                targetIds.length === 1 ? "" : "s"
              }`,
        );
        undoBus.push({
          message: shouldUnassign
            ? `Unassigned ${person}`
            : `Assigned ${person}`,
          undo: async () => {
            if (shouldUnassign) {
              for (const cardId of targetIds) addCardMemberLocal({ cardId, userId });
            } else {
              for (const cardId of targetIds) removeCardMemberLocal(cardId, userId);
            }
            try {
              await Promise.all(
                targetIds.map((cardId) => toggleCardMember({ cardId, userId })),
              );
            } catch (err) {
              if (shouldUnassign) {
                for (const cardId of targetIds) removeCardMemberLocal(cardId, userId);
              } else {
                for (const cardId of targetIds) addCardMemberLocal({ cardId, userId });
              }
              pushError("Undo failed: " + (err as Error).message);
            }
          },
        });
      } catch (err) {
        if (shouldUnassign) {
          for (const cardId of targetIds) addCardMemberLocal({ cardId, userId });
        } else {
          for (const cardId of targetIds) removeCardMemberLocal(cardId, userId);
        }
        pushError("Bulk assign failed: " + (err as Error).message);
      }
    });
  }

  function onSetSprint(sprintId: string | null) {
    const ids = canBulk;
    const prior = ids.map((id) => {
      const c = cards.find((x) => x.id === id);
      return { id, sprintId: c?.sprintId ?? null };
    });
    for (const id of ids) updateCardLocal(id, { sprintId });
    start(async () => {
      try {
        await bulkSetSprint({ cardIds: ids, sprintId });
        clearSelection();
        toast.success(
          `Sprint updated on ${ids.length} card${ids.length === 1 ? "" : "s"}`,
        );
        undoBus.push({
          message: `Sprint updated on ${ids.length} card${
            ids.length === 1 ? "" : "s"
          }`,
          undo: async () => {
            for (const p of prior) updateCardLocal(p.id, { sprintId: p.sprintId });
            try {
              await Promise.all(
                prior.map((p) =>
                  bulkSetSprint({ cardIds: [p.id], sprintId: p.sprintId }),
                ),
              );
            } catch (err) {
              for (const id of ids) updateCardLocal(id, { sprintId });
              pushError("Undo failed: " + (err as Error).message);
            }
          },
        });
      } catch (err) {
        for (const p of prior) updateCardLocal(p.id, { sprintId: p.sprintId });
        pushError("Bulk sprint failed: " + (err as Error).message);
      }
    });
  }

  function onSetPriority(priority: CardPriority | null) {
    const ids = canBulk;
    // Snapshot prior values for optimistic rollback.
    const prior = ids.map((id) => {
      const c = cards.find((x) => x.id === id);
      return { id, priority: (c?.priority ?? null) as CardPriority | null };
    });
    // Optimistic local update so tiles repaint immediately.
    for (const id of ids) {
      updateCardLocal(id, { priority });
    }
    start(async () => {
      try {
        await bulkSetPriority({ cardIds: ids, priority });
        clearSelection();
        toast.success(
          `Priority ${priority ? PRIORITY_LABELS[priority] : "cleared"} on ${
            ids.length
          } card${ids.length === 1 ? "" : "s"}`,
        );
        undoBus.push({
          message: `Priority ${priority ? PRIORITY_LABELS[priority] : "cleared"}`,
          undo: async () => {
            for (const p of prior) {
              updateCardLocal(p.id, { priority: p.priority });
            }
            try {
              await Promise.all(
                prior.map((p) =>
                  bulkSetPriority({ cardIds: [p.id], priority: p.priority }),
                ),
              );
            } catch (err) {
              for (const id of ids) updateCardLocal(id, { priority });
              pushError("Undo failed: " + (err as Error).message);
            }
          },
        });
      } catch (err) {
        // Rollback optimistic update.
        for (const p of prior) {
          updateCardLocal(p.id, { priority: p.priority });
        }
        pushError("Bulk priority failed: " + (err as Error).message);
      }
    });
  }

  function onAddComponent(componentId: string) {
    const ids = canBulk;
    const wasAttachedIds = new Set(
      cardComponents
        .filter((cc) => cc.componentId === componentId && ids.includes(cc.cardId))
        .map((cc) => cc.cardId),
    );
    for (const cardId of ids) {
      if (wasAttachedIds.has(cardId)) {
        removeCardComponentLocal(cardId, componentId);
      } else {
        addCardComponentLocal({
          cardId,
          componentId,
          boardId: "00000000-0000-0000-0000-000000000000",
        });
      }
    }
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
        const componentName =
          components.find((c) => c.id === componentId)?.name ?? "Component";
        undoBus.push({
          message: `Toggled ${componentName}`,
          undo: async () => {
            for (const cardId of ids) {
              if (wasAttachedIds.has(cardId)) {
                addCardComponentLocal({
                  cardId,
                  componentId,
                  boardId: "00000000-0000-0000-0000-000000000000",
                });
              } else {
                removeCardComponentLocal(cardId, componentId);
              }
            }
            try {
              await Promise.all(
                ids.map((cardId) =>
                  toggleCardComponent({ cardId, componentId }),
                ),
              );
            } catch (err) {
              for (const cardId of ids) {
                if (wasAttachedIds.has(cardId)) {
                  removeCardComponentLocal(cardId, componentId);
                } else {
                  addCardComponentLocal({
                    cardId,
                    componentId,
                    boardId: "00000000-0000-0000-0000-000000000000",
                  });
                }
              }
              pushError("Undo failed: " + (err as Error).message);
            }
          },
        });
      } catch (err) {
        for (const cardId of ids) {
          if (wasAttachedIds.has(cardId)) {
            addCardComponentLocal({
              cardId,
              componentId,
              boardId: "00000000-0000-0000-0000-000000000000",
            });
          } else {
            removeCardComponentLocal(cardId, componentId);
          }
        }
        pushError("Bulk component failed: " + (err as Error).message);
      }
    });
  }

  return (
    <div
      className="fixed inset-x-0 z-40 mx-auto max-w-3xl px-2 sm:px-3 pointer-events-none bottom-[max(env(safe-area-inset-bottom),0.5rem)] sm:bottom-3"
      data-testid="bulk-action-bar"
    >
      <div className="pointer-events-auto flex items-center gap-2 overflow-x-auto rounded-2xl border border-[color:var(--hairline-hi)] bg-[color:var(--popover)] px-3 py-2 text-sm text-fg shadow-xl animate-in fade-in slide-in-from-bottom-2 duration-200 max-sm:snap-x max-sm:snap-mandatory [&>*]:max-sm:snap-start">
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
            <DropdownMenuLabel>Assign member</DropdownMenuLabel>
            {profiles.map((p) => {
              const assignedCount = memberAssignmentCounts.get(p.id) ?? 0;
              const allAssigned = assignedCount === canBulk.length;
              const partiallyAssigned =
                assignedCount > 0 && assignedCount < canBulk.length;
              return (
                <DropdownMenuItem
                  key={p.id}
                  onClick={() => onAssignMember(p.id)}
                  data-assigned={
                    allAssigned
                      ? "all"
                      : partiallyAssigned
                        ? "partial"
                        : "none"
                  }
                >
                  <span className="flex size-4 shrink-0 items-center justify-center text-fg-muted">
                    {allAssigned ? (
                      <Check className="size-3.5" />
                    ) : partiallyAssigned ? (
                      <Minus className="size-3.5" />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {p.displayName}
                  </span>
                  {assignedCount > 0 && (
                    <span className="mono-meta-sm ml-3 text-fg-faint">
                      {assignedCount}/{canBulk.length}
                    </span>
                  )}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Priority */}
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={buttonsDisabled}
            data-testid="bulk-action-priority"
            className="chip mono-meta-sm inline-flex items-center gap-1 hover:bg-[rgb(255_255_255/0.08)] disabled:opacity-50"
          >
            <Flag className="size-3" />
            PRIORITY
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Set priority</DropdownMenuLabel>
            {(["p0", "p1", "p2", "p3", "p4"] as CardPriority[]).map((p) => (
              <DropdownMenuItem
                key={p}
                data-testid="bulk-action-priority-item"
                data-priority={p}
                onClick={() => onSetPriority(p)}
                className={PRIORITY_TINT[p].text}
              >
                <span
                  aria-hidden
                  className={`size-2 rounded-full mr-2 ${PRIORITY_TINT[p].dot}`}
                />
                {PRIORITY_LABELS[p]}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              data-testid="bulk-action-priority-clear"
              onClick={() => onSetPriority(null)}
            >
              Clear priority
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* More: Sprint + Component (rare actions) */}
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={buttonsDisabled}
            data-testid="bulk-action-more"
            className="chip mono-meta-sm inline-flex items-center gap-1 hover:bg-[rgb(255_255_255/0.08)] disabled:opacity-50"
          >
            <MoreHorizontal className="size-3" />
            MORE
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>More actions</DropdownMenuLabel>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Layers3 className="size-3.5" aria-hidden />
                  Set sprint
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={() => onSetSprint(null)}>
                    Backlog (clear)
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {sprints.map((s) => (
                    <DropdownMenuItem
                      key={s.id}
                      onClick={() => onSetSprint(s.id)}
                    >
                      {s.name}
                      <span className="ml-auto mono-meta-sm text-fg-faint">
                        {s.state}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              {components.length > 0 && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <ComponentIcon className="size-3.5" aria-hidden />
                    Toggle component
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {components.map((c) => (
                      <DropdownMenuItem
                        key={c.id}
                        onClick={() => onAddComponent(c.id)}
                      >
                        {c.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Mark complete */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={buttonsDisabled}
          onClick={onMarkCompleted}
          data-testid="bulk-action-complete"
        >
          <Check className="size-3.5 mr-1" />
          Mark complete
        </Button>

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
