"use client";

import { useMediaQuery } from "@/lib/use-media-query";

// True when the primary input is touch-only: no fine pointer and no hover
// capability. Used to swap drag activation, hit-target sizing, and the
// dialog/sheet routing across the app.
export function useIsTouchDevice(): boolean {
  return useMediaQuery("(hover: none) and (pointer: coarse)");
}
