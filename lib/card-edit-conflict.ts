// card-edit-concurrency U3 — client-side conflict plumbing shared by the
// three text-edit surfaces.

export type EditConflictContext = {
  currentRev: number;
  currentTitle: string;
  currentDescription: string | null;
};

export function isVersionConflict(error: {
  code?: string;
  context?: unknown;
}): error is { code: "VERSION_CONFLICT"; context: EditConflictContext } {
  return error.code === "VERSION_CONFLICT";
}

/** Thrown CLIENT-SIDE (never across the server-action boundary) by
 * onPatch implementations so the quick view can catch a typed conflict. */
export class CardEditConflictError extends Error {
  constructor(public ctx: EditConflictContext) {
    super("VERSION_CONFLICT");
    this.name = "CardEditConflictError";
  }
}
