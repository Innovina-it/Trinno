import { describe, it, expect } from "vitest";
import { createCardLinkImpl } from "@/actions/card-links";
import { StructuredError } from "@/lib/errors";

/**
 * U2 unit coverage — pre-DB throws only (paths that don't require RLS).
 * The remaining action codes (ACCESS_DENIED, NOT_MEMBER, ROLE_INSUFFICIENT,
 * cross-board cases, etc.) need a real user token + RLS, so they live in
 * tests/integration/forbidden-codes.test.ts.
 */
describe("action error codes (synchronous paths)", () => {
  const id = "11111111-1111-4111-8111-111111111111";

  it("createCardLinkImpl self-link → VALIDATION_ERROR { kind: self-link }", async () => {
    await expect(
      createCardLinkImpl("dummy.token.string", {
        fromCardId: id,
        toCardId: id,
        kind: "blocks",
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Cannot link card to itself",
      context: { kind: "self-link" },
    });
  });

  it("self-link error is a StructuredError instance with .code", async () => {
    let caught: unknown;
    try {
      await createCardLinkImpl("dummy.token.string", {
        fromCardId: id,
        toCardId: id,
        kind: "relates_to",
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(StructuredError);
    expect((caught as StructuredError).code).toBe("VALIDATION_ERROR");
  });
});
