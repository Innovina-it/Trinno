/**
 * Plan errors-onboarding (U3a) — UI copy keyed by StructuredError.code.
 *
 * Maps coded server errors to user-facing copy. Keep titles short
 * (fits a single ErrorPane row) and descriptions one sentence.
 * Fallback keeps the original server message visible so unmapped
 * codes degrade gracefully.
 */

export type ErrorCopy = {
  title: string;
  description?: string;
};

const COPY: Record<string, ErrorCopy> = {
  ACCESS_DENIED: {
    title: "Access denied",
    description:
      "You don't have permission to do that, or the item was removed.",
  },
  NOT_FOUND: {
    title: "Item no longer exists",
    description: "It was deleted or moved.",
  },
  NOT_MEMBER: {
    title: "Not a workspace member",
    description: "Ask an admin to add you before retrying.",
  },
  ROLE_INSUFFICIENT: {
    title: "Permission required",
    description: "Only workspace owners or admins can do that.",
  },
  VALIDATION_ERROR: {
    title: "Invalid action",
  },
  CONFLICT: {
    title: "Action blocked by current state",
  },
  SEED_PARTIAL: {
    title: "Workspace ready, but some steps couldn't complete",
  },
  SEED_STEP_FAILED: {
    title: "Setup step failed",
  },
  ACTION_FAILED: {
    title: "Something went wrong",
  },
};

/**
 * Returns the UI copy bundle for a given error code. When the code
 * is unmapped, returns a generic title and uses the server-provided
 * message as the description so callers still surface something
 * useful. Pass `fallbackMessage` to fall back to the raw server
 * message in that case (or in a code's description override).
 */
export function errorCopy(
  code: string | undefined,
  fallbackMessage?: string,
): ErrorCopy {
  if (code && COPY[code]) {
    const entry = COPY[code];
    // VALIDATION_ERROR and CONFLICT don't ship a fixed description —
    // the server message is more specific than anything we'd hard-code
    // here ("Cannot link card to itself" vs "Invalid action").
    if (!entry.description && fallbackMessage) {
      return { title: entry.title, description: fallbackMessage };
    }
    return entry;
  }
  return {
    title: "Something went wrong",
    description: fallbackMessage,
  };
}
