"use client";

/**
 * Plan #16b-γ-D (#10) — global undo bus.
 * undo-redo-stack Unit A1 — bounded undo/redo stacks.
 *
 * Actions push an entry with a `message`, an `undo()` callback and an
 * optional `redo()` callback. Entries accumulate on a bounded undo
 * stack (newest last); undoing moves an entry to the redo stack when it
 * supports redo, and any new push clears the redo stack.
 *
 * The banner remains a transient display of the most recent push: it
 * auto-hides after 8 seconds and its dismiss button hides it — neither
 * removes the entry from the stack. Entries expire after 10 minutes
 * (lazy prune) to bound the stale-overwrite window on shared data.
 *
 * In-memory only; lost on refresh, by design.
 */
export type UndoEntry = {
  id: string;
  message: string;
  undo: () => Promise<void> | void;
  redo?: () => Promise<void> | void;
  ts: number;
};

export type UndoInvokeResult = {
  /** Entry whose callback ran (or was attempted). Null = stack empty. */
  entry: UndoEntry | null;
  /** False when the callback threw (the site surfaces its own error). */
  ok: boolean;
};

type Listener = (entry: UndoEntry | null) => void;

const BANNER_MS = 8_000;
const MAX_AGE_MS = 10 * 60_000;
const STACK_CAP = 50;

const state: {
  undoStack: UndoEntry[];
  redoStack: UndoEntry[];
  banner: UndoEntry | null;
  listeners: Set<Listener>;
  timer: ReturnType<typeof setTimeout> | null;
} = {
  undoStack: [],
  redoStack: [],
  banner: null,
  listeners: new Set(),
  timer: null,
};

let counter = 0;
function nextId(): string {
  counter += 1;
  return `undo-${Date.now()}-${counter}`;
}

function emit() {
  for (const l of state.listeners) l(state.banner);
}

function clearTimer() {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
}

function hideBanner() {
  clearTimer();
  if (state.banner) {
    state.banner = null;
    emit();
  }
}

function prune() {
  const cutoff = Date.now() - MAX_AGE_MS;
  state.undoStack = state.undoStack.filter((e) => e.ts >= cutoff);
  state.redoStack = state.redoStack.filter((e) => e.ts >= cutoff);
}

export const undoBus = {
  push(input: {
    message: string;
    undo: () => Promise<void> | void;
    redo?: () => Promise<void> | void;
  }): string {
    prune();
    const entry: UndoEntry = {
      id: nextId(),
      message: input.message,
      undo: input.undo,
      redo: input.redo,
      ts: Date.now(),
    };
    state.undoStack.push(entry);
    if (state.undoStack.length > STACK_CAP) state.undoStack.shift();
    state.redoStack = [];
    clearTimer();
    state.banner = entry;
    state.timer = setTimeout(() => {
      // Hide the banner only — the entry stays on the stack.
      if (state.banner?.id === entry.id) {
        state.banner = null;
        emit();
      }
    }, BANNER_MS);
    emit();
    return entry.id;
  },
  /**
   * Pop the newest entry and run its undo(). Moves the entry to the
   * redo stack only when it supports redo AND its undo succeeded.
   */
  async undo(): Promise<UndoInvokeResult> {
    prune();
    const entry = state.undoStack.pop() ?? null;
    hideBanner();
    if (!entry) return { entry: null, ok: true };
    try {
      await entry.undo();
    } catch {
      // Swallow — the undo failure surfaces via the action's own error
      // bus push or toast. A failed undo is not redoable.
      return { entry, ok: false };
    }
    if (entry.redo) {
      state.redoStack.push({ ...entry, ts: Date.now() });
    }
    return { entry, ok: true };
  },
  /**
   * Pop the newest redoable entry and run its redo(). On success the
   * entry returns to the undo stack so it can be undone again.
   */
  async redo(): Promise<UndoInvokeResult> {
    prune();
    const entry = state.redoStack.pop() ?? null;
    hideBanner();
    if (!entry) return { entry: null, ok: true };
    try {
      await entry.redo!();
    } catch {
      return { entry, ok: false };
    }
    state.undoStack.push({ ...entry, ts: Date.now() });
    if (state.undoStack.length > STACK_CAP) state.undoStack.shift();
    return { entry, ok: true };
  },
  /** Banner UNDO button — undo the newest entry. */
  async invoke(): Promise<void> {
    await this.undo();
  },
  /** Hide the banner. The entry stays on the undo stack. */
  dismiss(): void {
    hideBanner();
  },
  subscribe(listener: Listener): () => void {
    state.listeners.add(listener);
    listener(state.banner);
    return () => {
      state.listeners.delete(listener);
    };
  },
  /** Read-only snapshot of the banner-visible entry (tests + banner). */
  snapshot(): UndoEntry | null {
    return state.banner;
  },
  /** Test helper: shallow copies of both stacks (newest last). */
  _stacksForTests(): { undo: UndoEntry[]; redo: UndoEntry[] } {
    return { undo: [...state.undoStack], redo: [...state.redoStack] };
  },
  /** Test helper: tear down timers + state between tests. */
  _resetForTests(): void {
    clearTimer();
    state.undoStack = [];
    state.redoStack = [];
    state.banner = null;
    state.listeners.clear();
    counter = 0;
  },
};
