"use client";

import {
  StructuredError,
  toStructuredError,
  type StructuredErrorShape,
} from "@/lib/errors/structured-error";

/**
 * Plan #16b-γ-C (#6) — global error bus.
 *
 * Toasts fade after 4-6s, which is fine for a "Saved" success but a
 * mistake for action failures the user might want to retry or
 * understand. The error pane subscribes to this bus and renders a
 * persistent collapsible bar at the top of the viewport with a Retry
 * button (when a retry callback is provided) and a manual dismiss.
 *
 * Migration policy: callers opt in by importing `errorBus` and pushing
 * on failure. This slice exposes the bus + pane and proves the wiring
 * with one or two high-traffic actions; remaining toast.error sites
 * stay as-is until they're touched again.
 */

export type ErrorEntry = {
  id: string;
  error: StructuredErrorShape;
  code: string;
  message: string;
  context?: unknown;
  ts: number;
  retry?: () => Promise<void> | void;
};

type Listener = (entries: ErrorEntry[]) => void;

const state: { entries: ErrorEntry[]; listeners: Set<Listener> } = {
  entries: [],
  listeners: new Set(),
};

function emit() {
  for (const l of state.listeners) l(state.entries);
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `err-${Date.now()}-${counter}`;
}

export const errorBus = {
  push(input: {
    message: string;
    code?: string;
    context?: unknown;
    error?: unknown;
    retry?: () => Promise<void> | void;
  }): string {
    const error = input.error
      ? toStructuredError(input.error, input.code ?? "ACTION_FAILED", input.context)
      : new StructuredError(
          input.code ?? "ACTION_FAILED",
          input.message,
          input.context,
        ).toJSON();
    const entry: ErrorEntry = {
      id: nextId(),
      error,
      code: error.code,
      message: error.message,
      context: error.context,
      ts: Date.now(),
      retry: input.retry,
    };
    state.entries = [entry, ...state.entries];
    emit();
    return entry.id;
  },
  dismiss(id: string) {
    state.entries = state.entries.filter((e) => e.id !== id);
    emit();
  },
  clear() {
    state.entries = [];
    emit();
  },
  subscribe(listener: Listener): () => void {
    state.listeners.add(listener);
    listener(state.entries);
    return () => {
      state.listeners.delete(listener);
    };
  },
  /** Read-only snapshot for tests. */
  snapshot(): ErrorEntry[] {
    return state.entries;
  },
};
