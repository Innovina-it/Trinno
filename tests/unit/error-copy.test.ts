import { describe, expect, it } from "vitest";
import { errorCopy } from "@/lib/errors/copy";

/**
 * Plan errors-onboarding (U3d) — code → UI copy data contract.
 *
 * Locks the 8 SPEC done-criteria copies + the U4 banner. ErrorPane
 * renders via `errorCopy(entry.code, entry.message)`, so locking the
 * lookup table here is equivalent to locking the rendered copy.
 */

describe("errorCopy lookup table", () => {
  it("ACCESS_DENIED → 'Access denied' + permission/removed hint", () => {
    const c = errorCopy("ACCESS_DENIED");
    expect(c.title).toBe("Access denied");
    expect(c.description).toMatch(/don't have permission|item was removed/i);
  });

  it("NOT_FOUND → 'Item no longer exists'", () => {
    const c = errorCopy("NOT_FOUND");
    expect(c.title).toBe("Item no longer exists");
    expect(c.description).toMatch(/deleted|moved/i);
  });

  it("NOT_MEMBER → 'Not a workspace member'", () => {
    const c = errorCopy("NOT_MEMBER");
    expect(c.title).toBe("Not a workspace member");
  });

  it("ROLE_INSUFFICIENT → 'Permission required'", () => {
    const c = errorCopy("ROLE_INSUFFICIENT");
    expect(c.title).toBe("Permission required");
  });

  it("VALIDATION_ERROR → 'Invalid action' + server message as description", () => {
    const c = errorCopy("VALIDATION_ERROR", "Cannot link card to itself");
    expect(c.title).toBe("Invalid action");
    expect(c.description).toBe("Cannot link card to itself");
  });

  it("CONFLICT → 'Action blocked' + server message as description", () => {
    const c = errorCopy("CONFLICT", "Cannot start: not planned");
    expect(c.title).toBe("Action blocked by current state");
    expect(c.description).toBe("Cannot start: not planned");
  });

  it("SEED_PARTIAL → 'Workspace ready' + server message as description", () => {
    const c = errorCopy(
      "SEED_PARTIAL",
      "Steps that failed: comments, watchers",
    );
    expect(c.title).toBe("Workspace ready");
    expect(c.description).toBe("Steps that failed: comments, watchers");
  });

  it("ACTION_FAILED falls back to 'Something went wrong' + server message", () => {
    const c = errorCopy("ACTION_FAILED", "Unexpected");
    expect(c.title).toBe("Something went wrong");
  });

  it("unknown code degrades to 'Something went wrong' + server message", () => {
    const c = errorCopy("MYSTERY_CODE", "huh");
    expect(c.title).toBe("Something went wrong");
    expect(c.description).toBe("huh");
  });

  it("undefined code degrades to 'Something went wrong'", () => {
    const c = errorCopy(undefined, "boom");
    expect(c.title).toBe("Something went wrong");
    expect(c.description).toBe("boom");
  });
});
