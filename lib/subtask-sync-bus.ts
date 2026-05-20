"use client";

/**
 * Tiny pub/sub fired by CompleteToggle after every successful card
 * completion toggle. The board-scoped <SubtaskParentSyncPrompt /> mount
 * listens; if the toggled card is a sub-task whose parent meets the
 * transition criteria (all siblings done & parent open → prompt for
 * Done; one sibling reopened & parent in Done state → prompt for
 * In progress), the prompt opens.
 *
 * Replaces the DB-trigger cascade removed in migration 0109.
 *
 * Emits are no-ops when no listener is mounted (surfaces outside a
 * board page — workspace tasks, sprint backlog, /me timeline — just
 * don't prompt).
 */

export type SubtaskSyncEvent = {
  cardId: string;
  completed: boolean;
};

type Listener = (event: SubtaskSyncEvent) => void;

const listeners = new Set<Listener>();

export const subtaskSyncBus = {
  emit(event: SubtaskSyncEvent): void {
    for (const l of listeners) l(event);
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  _resetForTests(): void {
    listeners.clear();
  },
};
