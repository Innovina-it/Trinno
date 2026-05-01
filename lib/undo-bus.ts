"use client";

/**
 * Plan #16b-γ-D (#10) — global undo bus.
 *
 * High-traffic destructive actions (move/archive/delete) push an entry
 * with a `message` and an `undo()` callback. The banner subscribes to
 * the bus and displays the most-recent entry for 8 seconds with an Undo
 * button. Only one banner is shown at a time — a new push replaces the
 * pending one (the previous undo is forfeit, matching the Gmail UX).
 *
 * In-memory only; lost on refresh, by design.
 */
export type UndoEntry = {
  id: string;
  message: string;
  undo: () => Promise<void> | void;
  ts: number;
};

type Listener = (entry: UndoEntry | null) => void;

const RETENTION_MS = 8_000;

const state: { current: UndoEntry | null; listeners: Set<Listener>; timer: ReturnType<typeof setTimeout> | null } = {
  current: null,
  listeners: new Set(),
  timer: null,
};

let counter = 0;
function nextId(): string {
  counter += 1;
  return `undo-${Date.now()}-${counter}`;
}

function emit() {
  for (const l of state.listeners) l(state.current);
}

function clearTimer() {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
}

export const undoBus = {
  push(input: { message: string; undo: () => Promise<void> | void }): string {
    clearTimer();
    const entry: UndoEntry = {
      id: nextId(),
      message: input.message,
      undo: input.undo,
      ts: Date.now(),
    };
    state.current = entry;
    state.timer = setTimeout(() => {
      // Expire silently — the user accepted the action.
      if (state.current?.id === entry.id) {
        state.current = null;
        emit();
      }
    }, RETENTION_MS);
    emit();
    return entry.id;
  },
  /** Run the current entry's undo() and clear the banner. */
  async invoke(): Promise<void> {
    const entry = state.current;
    if (!entry) return;
    clearTimer();
    state.current = null;
    emit();
    try {
      await entry.undo();
    } catch {
      // Swallow — the undo failure surfaces via the action's own error
      // bus push or toast.
    }
  },
  dismiss(): void {
    clearTimer();
    state.current = null;
    emit();
  },
  subscribe(listener: Listener): () => void {
    state.listeners.add(listener);
    listener(state.current);
    return () => {
      state.listeners.delete(listener);
    };
  },
  /** Read-only snapshot for tests. */
  snapshot(): UndoEntry | null {
    return state.current;
  },
  /** Test helper: tear down timer + state between tests. */
  _resetForTests(): void {
    clearTimer();
    state.current = null;
    state.listeners.clear();
    counter = 0;
  },
};
