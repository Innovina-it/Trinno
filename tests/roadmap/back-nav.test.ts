import { describe, expect, it, vi } from "vitest";
import {
  consumeRoadmapCardOrigin,
  rememberRoadmapCardOrigin,
  restoreRoadmapCardOrigin,
} from "@/lib/roadmap/back-nav";

function makeStorageShim() {
  const storage = new Map<string, string>();
  return {
    setItem: (key: string, value: string) => storage.set(key, value),
    getItem: (key: string) => storage.get(key) ?? null,
    removeItem: (key: string) => storage.delete(key),
  };
}

describe("roadmap card back navigation", () => {
  it("restores Roadmap origin instead of falling back to Board", () => {
    const storageShim = makeStorageShim();
    const router = { replace: vi.fn() };

    rememberRoadmapCardOrigin("ws-1", "?zoom=fit", storageShim);
    const restored = restoreRoadmapCardOrigin(
      router,
      "/b/board-1",
      storageShim,
    );

    expect(restored).toBe("/w/ws-1/roadmap?zoom=fit");
    expect(router.replace).toHaveBeenCalledWith("/w/ws-1/roadmap?zoom=fit", {
      scroll: false,
    });
  });

  it("consumeRoadmapCardOrigin returns and clears the stored href without navigating", () => {
    // Card-modal close uses this to decide between 'return to roadmap'
    // and 'router.back()' when leaving the detail page. Previously the
    // breadcrumb was cleared+navigated in one step on quick-view's
    // openAdvanced, so the detail-page close had nothing to consume and
    // the user landed on the board. With consume(), the quick-view
    // leaves the breadcrumb intact and the modal close decides.
    const storageShim = makeStorageShim();
    rememberRoadmapCardOrigin("ws-2", "?team=eng", storageShim);

    const first = consumeRoadmapCardOrigin(storageShim);
    expect(first).toBe("/w/ws-2/roadmap?team=eng");

    // One-shot: a second consume returns null (already cleared).
    const second = consumeRoadmapCardOrigin(storageShim);
    expect(second).toBeNull();
  });

  it("consumeRoadmapCardOrigin returns null when nothing was stored", () => {
    const storageShim = makeStorageShim();
    expect(consumeRoadmapCardOrigin(storageShim)).toBeNull();
  });

  it("card-quick-view openAdvanced does NOT call onClose (preserves breadcrumb)", async () => {
    // Regression: previously openAdvanced ran onClose() + router.push()
    // which fired restoreRoadmapCardOrigin (consuming + URL-replacing)
    // before the push to /b/.../c/{cardId}. Detail-page close then had
    // nothing to consume → fell back to router.back() → board.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("components/board/card-quick-view.tsx", "utf8");
    // openAdvanced body must not invoke onClose.
    const match = src.match(/function openAdvanced[\s\S]*?\n\s\s\}/);
    expect(match, "expected openAdvanced function to be present").not.toBeNull();
    const body = match![0];
    expect(body).not.toMatch(/\bonClose\(\)/);
    expect(body).toMatch(/router\.push\(`\/b\/\$\{boardId\}\/c\/\$\{card\.id\}`/);
  });

  it("card-modal close consumes the breadcrumb before falling back to router.back()", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("components/board/card-modal.tsx", "utf8");
    expect(src).toMatch(/import\s*\{[^}]*consumeRoadmapCardOrigin[^}]*\}\s*from\s*"@\/lib\/roadmap\/back-nav"/);
    const closeMatch = src.match(/function close\(\)\s*\{[\s\S]*?\n\s\s\}/);
    expect(closeMatch, "expected close() function").not.toBeNull();
    const body = closeMatch![0];
    expect(body).toMatch(/consumeRoadmapCardOrigin\(\)/);
    expect(body).toMatch(/router\.replace\(/);
    expect(body).toMatch(/router\.back\(\)/);
  });
});
