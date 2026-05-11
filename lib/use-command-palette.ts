"use client";
import { useSyncExternalStore } from "react";

const EVENT = "trinno:command-palette";

let openState = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVENT));
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function openCommandPalette(): void {
  if (openState) return;
  openState = true;
  emit();
}

export function closeCommandPalette(): void {
  if (!openState) return;
  openState = false;
  emit();
}

export function toggleCommandPalette(): void {
  openState = !openState;
  emit();
}

export function useCommandPalette(): {
  open: boolean;
  setOpen: (next: boolean) => void;
} {
  const open = useSyncExternalStore(
    subscribe,
    () => openState,
    () => false,
  );
  return {
    open,
    setOpen: (next: boolean) => {
      if (next === openState) return;
      openState = next;
      emit();
    },
  };
}
