export const TAB_ID_STORAGE_KEY = "trinno_tab_id";
export const TAB_ID_HEADER = "x-tab-id";

let cached: string | undefined;

function generate(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `tab-${Math.random().toString(36).slice(2)}${Math.random()
      .toString(36)
      .slice(2)}`
  );
}

export function getTabId(): string {
  if (typeof window === "undefined" || typeof sessionStorage === "undefined") {
    return "";
  }

  if (cached) return cached;

  try {
    const existing = sessionStorage.getItem(TAB_ID_STORAGE_KEY);
    if (existing) {
      cached = existing;
      return existing;
    }
    const fresh = generate();
    sessionStorage.setItem(TAB_ID_STORAGE_KEY, fresh);
    cached = fresh;
    return fresh;
  } catch {
    if (!cached) cached = generate();
    return cached;
  }
}

export function resetTabId(): void {
  cached = undefined;
  if (typeof window === "undefined" || typeof sessionStorage === "undefined") {
    return;
  }
  try {
    sessionStorage.removeItem(TAB_ID_STORAGE_KEY);
  } catch {
    /* swallow */
  }
}
