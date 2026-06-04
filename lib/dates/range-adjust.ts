// Ordering helper for free-standing start/target date pickers (card quick-view).
// When the start date moves, the target should hold its position — it only
// moves when the new start would land *after* it, which would otherwise invert
// the range. A start on or before the existing target leaves the target alone.
//
// This intentionally does NOT preserve span (sliding the target by the same
// delta): users editing the start date expect the target to stay put unless
// the move makes the pair invalid.
export function adjustTargetForStart(
  newStart: Date | null,
  target: Date | null,
): Date | null {
  if (!newStart || !target) return target;
  return newStart.getTime() > target.getTime() ? newStart : target;
}
