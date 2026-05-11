"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;

function clamp(n: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, n));
}

// Two-finger pinch handler for wide data-viz surfaces (roadmap, workload).
// Wires up PointerEvent listeners on `ref.current`; consumers apply the
// returned `scale` via CSS `transform: scale(...)` themselves so we don't
// fight the existing scroll/positioning math inside the canvas.
//
// `reset()` snaps back to 1 and clears the in-flight gesture.
export function usePinchZoom(ref: RefObject<HTMLElement | null>): {
  scale: number;
  reset: () => void;
} {
  const [scale, setScale] = useState(1);
  const baselineRef = useRef(1);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const startDistanceRef = useRef<number | null>(null);

  const reset = useCallback(() => {
    pointersRef.current.clear();
    startDistanceRef.current = null;
    baselineRef.current = 1;
    setScale(1);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reducedMotion) {
      el.style.transition = "transform 0ms";
    } else {
      el.style.transition = "transform 200ms cubic-bezier(0.16, 1, 0.3, 1)";
    }
    el.style.transformOrigin = "center center";
    el.style.touchAction = "pan-x pan-y";

    function distance(): number | null {
      const pts = Array.from(pointersRef.current.values());
      if (pts.length < 2) return null;
      const [a, b] = pts;
      return Math.hypot(a.x - b.x, a.y - b.y);
    }

    function onPointerDown(e: PointerEvent) {
      if (e.pointerType !== "touch") return;
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointersRef.current.size === 2) {
        startDistanceRef.current = distance();
        baselineRef.current = scale;
      }
    }

    function onPointerMove(e: PointerEvent) {
      if (e.pointerType !== "touch") return;
      const prev = pointersRef.current.get(e.pointerId);
      if (!prev) return;
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointersRef.current.size !== 2 || startDistanceRef.current == null) {
        return;
      }
      const d = distance();
      if (d == null || startDistanceRef.current === 0) return;
      const next = clamp((d / startDistanceRef.current) * baselineRef.current);
      setScale(next);
    }

    function onPointerEnd(e: PointerEvent) {
      if (e.pointerType !== "touch") return;
      pointersRef.current.delete(e.pointerId);
      if (pointersRef.current.size < 2) {
        startDistanceRef.current = null;
      }
    }

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerEnd);
    el.addEventListener("pointercancel", onPointerEnd);
    el.addEventListener("pointerleave", onPointerEnd);

    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerEnd);
      el.removeEventListener("pointercancel", onPointerEnd);
      el.removeEventListener("pointerleave", onPointerEnd);
      el.style.transition = "";
      el.style.transformOrigin = "";
      el.style.touchAction = "";
    };
  }, [ref, scale]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.transform = `scale(${scale})`;
  }, [ref, scale]);

  return { scale, reset };
}
