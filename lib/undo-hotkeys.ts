import { isEditableShortcutTarget } from "@/lib/command-palette/shortcut-guard";

/**
 * undo-redo-stack Unit A2 — classify a keydown as an app-level undo or
 * redo. Returns null while typing in form controls / contenteditable so
 * native text undo always wins (focus guard).
 */
export function classifyUndoHotkey(
  event: Pick<
    KeyboardEvent,
    "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "target"
  >,
): "undo" | "redo" | null {
  if (!(event.metaKey || event.ctrlKey)) return null;
  if (event.altKey) return null;
  if (event.key.toLowerCase() !== "z") return null;
  if (isEditableShortcutTarget(event.target)) return null;
  return event.shiftKey ? "redo" : "undo";
}
