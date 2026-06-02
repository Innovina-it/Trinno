export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function isBoardRoute(pathname: string | null | undefined): boolean {
  return /^\/(?:b|board)\//.test(pathname ?? "");
}

export function shouldSuppressQuickAddShortcut(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "target">,
  pathname: string | null | undefined,
): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  if (event.key !== "c" && event.key !== "C") return false;
  return !isBoardRoute(pathname) || isEditableShortcutTarget(event.target);
}
