"use client";
import { useSyncExternalStore } from "react";

const STORAGE_KEY = "trinno:activity-open";
const EVENT = "trinno:activity-toggle";

function read(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function subscribe(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, cb);
  // Cross-tab updates surface via the storage event.
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

function write(next: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    /* storage may be unavailable */
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

/**
 * Activity-panel open/closed state, backed by localStorage and shared
 * across components in the same tab via a custom event. SSR-safe via
 * useSyncExternalStore's server snapshot (always closed on the server).
 */
export function useActivityPanel(): {
  open: boolean;
  toggle: () => void;
  set: (next: boolean) => void;
} {
  const open = useSyncExternalStore(
    subscribe,
    read,
    () => false,
  );
  return {
    open,
    toggle: () => write(!read()),
    set: (next: boolean) => write(next),
  };
}
