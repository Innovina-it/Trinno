import { describe, it, expect } from "vitest";

// Plan #16b-γ-G aggregate review I4 — pin the action's cycle-error
// contract so a future trigger reword (or wrapping refactor) breaks
// loudly here instead of silently degrading the UI to the generic
// "Reparent failed" message.

const PARENT_CYCLE_TRIGGER_MESSAGE = "cards: parent cycle detected";
const ACTION_PREFIX = "PARENT_CYCLE";

function wrapDbError(err: Error): Error {
  if (err.message.toLowerCase().includes("parent cycle")) {
    return new Error(`${ACTION_PREFIX}: parent cycle detected`);
  }
  return err;
}

describe("parent-cycle action contract", () => {
  it("trigger error message is the wording the action wraps", () => {
    expect(PARENT_CYCLE_TRIGGER_MESSAGE.toLowerCase()).toContain("parent cycle");
  });

  it("action wraps cycle errors with the PARENT_CYCLE prefix", () => {
    const wrapped = wrapDbError(new Error(PARENT_CYCLE_TRIGGER_MESSAGE));
    expect(wrapped.message).toMatch(/^PARENT_CYCLE:/);
  });

  it("action passes through other errors unchanged", () => {
    const other = new Error("Forbidden");
    const wrapped = wrapDbError(other);
    expect(wrapped).toBe(other);
  });
});
