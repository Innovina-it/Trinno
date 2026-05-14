import { describe, expect, it } from "vitest";
import { errorBus } from "@/lib/errors/error-bus";
import { StructuredError, toStructuredError } from "@/lib/errors";

describe("structured errors", () => {
  it("normalizes thrown and emitted errors into the structured shape", () => {
    const parsed = toStructuredError(
      new StructuredError("SEED_FAILED", "Seed failed", { step: "workspace" }),
    );
    expect(parsed).toEqual({
      code: "SEED_FAILED",
      message: "Seed failed",
      context: { step: "workspace" },
    });

    errorBus.clear();
    errorBus.push({ message: "Quick-add failed", code: "QUICK_ADD_FAILED" });
    expect(errorBus.snapshot()[0].error).toMatchObject({
      code: "QUICK_ADD_FAILED",
      message: "Quick-add failed",
    });
  });
});
