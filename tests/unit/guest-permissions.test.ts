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

  it("allows status change only on assigned cards (#0111)", () => {
    expect(
      hasGuestAccess({
        role: "guest",
        action: "update_own_card_status",
        cardAssigned: true,
      }),
    ).toBe(true);

    expect(
      hasGuestAccess({
        role: "guest",
        action: "update_own_card_status",
        cardAssigned: false,
      }),
    ).toBe(false);

    expect(
      hasGuestAccess({
        role: "guest",
        action: "update_own_card_status",
      }),
    ).toBe(false);
  });

  it("non-guests bypass the gate for any action", () => {
    for (const role of ["owner", "admin", "member"] as const) {
      expect(
        hasGuestAccess({
          role,
          action: "update_own_card_status",
        }),
      ).toBe(true);
      expect(
        hasGuestAccess({
          role,
          action: "create_board",
        }),
      ).toBe(true);
    }
  });
});
