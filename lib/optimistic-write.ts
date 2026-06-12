"use client";

import { toast } from "sonner";
import { undoBus } from "@/lib/undo-bus";

/**
 * instant-feedback Unit A1 — the canonical optimistic edit, extracted
 * from the ~20 hand-rolled closures the undo-redo-stack work left
 * behind. One call gives a site the full contract:
 *
 *   1. apply(next) locally — the screen updates BEFORE the network
 *   2. write(next) on the server in the background
 *   3. on failure: apply(prev) rollback + error toast + rethrow
 *   4. on success: an undo-bus entry whose undo/redo replay the same
 *      apply→write→rollback steps with the values swapped
 *
 * Usage:
 *   await optimisticWrite({
 *     prev, next,
 *     apply: (v) => updateCardLocal(cardId, { estimateMin: v }),
 *     write: (v) => updateCard({ id: cardId, estimateMin: v }),
 *     message: "Estimate updated",
 *   });
 *
 * The bus swallows undo errors and only moves entries to the redo
 * stack when the callback resolves — rethrowing here keeps a failed
 * reversal out of the redo stack (undo-bus contract).
 */
export async function optimisticWrite<T>(input: {
  prev: T;
  next: T;
  apply: (value: T) => void;
  write: (value: T) => Promise<unknown>;
  /** Undo-bus entry message, e.g. `Priority High`. */
  message: string;
  /** Prefix for failure toasts; defaults to the entry message. */
  errorLabel?: string;
}): Promise<void> {
  const { prev, next, apply, write, message } = input;
  const label = input.errorLabel ?? message;

  const run = async (to: T, from: T, prefix: string | null) => {
    apply(to);
    try {
      await write(to);
    } catch (err) {
      apply(from);
      // Initial write failure reads like every existing site (raw server
      // message); undo/redo failures name the entry they belong to.
      toast.error(
        prefix === null
          ? (err as Error).message
          : `${prefix}${label}: ${(err as Error).message}`,
      );
      throw err;
    }
  };

  await run(next, prev, null);
  undoBus.push({
    message,
    undo: () => run(prev, next, "Undo failed — "),
    redo: () => run(next, prev, "Redo failed — "),
  });
}
