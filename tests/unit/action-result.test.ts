import { describe, expect, it } from "vitest";
import { StructuredError, actionResult } from "@/lib/errors";

describe("actionResult boundary helper", () => {
  it("returns ok with data when fn resolves", async () => {
    const r = await actionResult(async () => ({ id: "x", n: 1 }));
    expect(r).toEqual({ ok: true, data: { id: "x", n: 1 } });
  });

  it("passes StructuredError through with code, message, context", async () => {
    const r = await actionResult(async () => {
      throw new StructuredError("ACCESS_DENIED", "nope", { listId: "L1" });
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toEqual({
      code: "ACCESS_DENIED",
      message: "nope",
      context: { listId: "L1" },
    });
  });

  it("maps plain Error to ACTION_FAILED with preserved message", async () => {
    const r = await actionResult(async () => {
      throw new Error("boom");
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("ACTION_FAILED");
    expect(r.error.message).toBe("boom");
  });

  it("maps non-Error throws to ACTION_FAILED with String(value) message", async () => {
    const rStr = await actionResult(async () => {
      throw "kaboom";
    });
    expect(rStr.ok).toBe(false);
    if (rStr.ok) return;
    expect(rStr.error.code).toBe("ACTION_FAILED");
    expect(rStr.error.message).toBe("kaboom");

    const rNull = await actionResult(async () => {
      throw null;
    });
    expect(rNull.ok).toBe(false);
    if (rNull.ok) return;
    expect(rNull.error.code).toBe("ACTION_FAILED");
    expect(rNull.error.message).toBe("null");
  });
});
