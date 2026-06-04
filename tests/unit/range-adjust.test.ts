import { describe, expect, it } from "vitest";
import { adjustTargetForStart } from "@/lib/dates/range-adjust";

const d = (iso: string) => new Date(iso + "T00:00:00.000Z");

describe("adjustTargetForStart", () => {
  it("leaves the target untouched when the new start stays on/before it", () => {
    // The reported bug: moving start earlier dragged the target with it.
    const target = d("2026-06-20");
    expect(adjustTargetForStart(d("2026-06-10"), target)).toBe(target);
    expect(adjustTargetForStart(d("2026-06-01"), target)).toBe(target);
  });

  it("leaves the target untouched when new start equals the target", () => {
    const target = d("2026-06-20");
    expect(adjustTargetForStart(d("2026-06-20"), target)).toBe(target);
  });

  it("pushes the target forward only when the new start passes it", () => {
    const newStart = d("2026-06-25");
    expect(adjustTargetForStart(newStart, d("2026-06-20"))).toBe(newStart);
  });

  it("returns the target unchanged when either value is null", () => {
    const target = d("2026-06-20");
    expect(adjustTargetForStart(null, target)).toBe(target);
    expect(adjustTargetForStart(d("2026-06-10"), null)).toBeNull();
    expect(adjustTargetForStart(null, null)).toBeNull();
  });
});
