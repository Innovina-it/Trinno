"use client";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { undoBus } from "@/lib/undo-bus";
import { classifyUndoHotkey } from "@/lib/undo-hotkeys";

/**
 * undo-redo-stack Unit A2 — global undo/redo hotkeys.
 *
 * Cmd/Ctrl+Z walks the undo stack, Cmd/Ctrl+Shift+Z the redo stack.
 * No-ops while typing (native text undo wins). Rapid presses are
 * serialized through a promise queue so server actions never overlap.
 * Renders nothing; mounted once from app/(app)/layout.tsx.
 */
export function UndoHotkeys() {
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const kind = classifyUndoHotkey(e);
      if (!kind) return;
      e.preventDefault();
      queue.current = queue.current.then(async () => {
        const result = kind === "undo" ? await undoBus.undo() : await undoBus.redo();
        if (result.entry && result.ok) {
          toast.success(
            kind === "undo"
              ? `Undid: ${result.entry.message}`
              : `Redid: ${result.entry.message}`,
          );
        }
        // entry && !ok → the action's own error toast already fired.
        // entry null → empty stack, stay quiet.
      });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return null;
}
