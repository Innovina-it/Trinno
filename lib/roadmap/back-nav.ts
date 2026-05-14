const ROADMAP_CARD_ORIGIN_KEY = "roadmap:card-origin";

export type RoadmapBackNavRouter = {
  replace: (href: string, options?: { scroll?: boolean }) => void;
};

export function roadmapHref(workspaceId: string, search = ""): string {
  return `/w/${workspaceId}/roadmap${search}`;
}

export function rememberRoadmapCardOrigin(
  workspaceId: string,
  search = "",
  storage: Pick<Storage, "setItem"> | null =
    typeof window === "undefined" ? null : window.sessionStorage,
): string {
  const href = roadmapHref(workspaceId, search);
  try {
    storage?.setItem(ROADMAP_CARD_ORIGIN_KEY, href);
  } catch {
    /* sessionStorage is best-effort; the route itself still has the href. */
  }
  return href;
}

// Consume the stored origin without navigating. Returns the stored href
// or null. Used by card-modal close to decide between "go back to
// roadmap I came from" vs the default `router.back()` flow when the
// user reached the detail page from the board.
export function consumeRoadmapCardOrigin(
  storage: Pick<Storage, "getItem" | "removeItem"> | null =
    typeof window === "undefined" ? null : window.sessionStorage,
): string | null {
  try {
    const href = storage?.getItem(ROADMAP_CARD_ORIGIN_KEY) ?? null;
    if (href) storage?.removeItem(ROADMAP_CARD_ORIGIN_KEY);
    return href || null;
  } catch {
    return null;
  }
}

export function restoreRoadmapCardOrigin(
  router: RoadmapBackNavRouter,
  fallbackHref: string,
  storage: Pick<Storage, "getItem" | "removeItem"> | null =
    typeof window === "undefined" ? null : window.sessionStorage,
): string {
  let href = fallbackHref;
  try {
    href = storage?.getItem(ROADMAP_CARD_ORIGIN_KEY) || fallbackHref;
    storage?.removeItem(ROADMAP_CARD_ORIGIN_KEY);
  } catch {
    href = fallbackHref;
  }
  router.replace(href, { scroll: false });
  return href;
}
