import { describe, expect, it } from "vitest";
import { hasGuestAccess } from "@/lib/permissions/has-guest-access";

describe("guest permissions", () => {
  it("allows assigned-card comment reads but blocks board creation", () => {
    expect(
      hasGuestAccess({
        role: "guest",
        action: "read_card_comments",
        cardAssigned: true,
      }),
    ).toBe(true);

    expect(
      hasGuestAccess({
        role: "guest",
        action: "create_board",
        boardAssigned: true,
      }),
    ).toBe(false);
  });
});
