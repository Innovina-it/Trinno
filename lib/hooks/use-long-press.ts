import { useCallback, useRef } from "react";

export type LongPressHandlers = {
  onPointerDown: (e: { button?: number }) => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
  onContextMenu: (e: { preventDefault: () => void }) => void;
};

// Short click (< threshold) -> onClick. Hold (>= threshold) -> onLongPress,
// and the subsequent pointer-up does NOT fire onClick. Pointer-based so it
// works for mouse and touch. onLongPress omitted => always a click.
export function useLongPress(opts: {
  onClick: () => void;
  onLongPress?: () => void;
  threshold?: number;
}): LongPressHandlers {
  const { onClick, onLongPress, threshold = 500 } = opts;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);

  const clear = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  }, []);

  const onPointerDown = useCallback((e: { button?: number }) => {
    if (e.button != null && e.button !== 0) return;
    fired.current = false;
    if (!onLongPress) return;
    timer.current = setTimeout(() => { fired.current = true; onLongPress(); }, threshold);
  }, [onLongPress, threshold]);

  const onPointerUp = useCallback(() => {
    clear();
    if (!fired.current) onClick();
    fired.current = false;
  }, [clear, onClick]);

  const onPointerLeave = useCallback(() => { clear(); fired.current = false; }, [clear]);
  const onContextMenu = useCallback((e: { preventDefault: () => void }) => {
    if (onLongPress) e.preventDefault();
  }, [onLongPress]);

  return { onPointerDown, onPointerUp, onPointerLeave, onContextMenu };
}
