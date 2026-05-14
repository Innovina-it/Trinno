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
