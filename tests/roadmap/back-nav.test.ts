import { describe, expect, it, vi } from "vitest";
import {
  rememberRoadmapCardOrigin,
  restoreRoadmapCardOrigin,
} from "@/lib/roadmap/back-nav";

describe("roadmap card back navigation", () => {
  it("restores Roadmap origin instead of falling back to Board", () => {
    const storage = new Map<string, string>();
    const storageShim = {
      setItem: (key: string, value: string) => storage.set(key, value),
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => storage.delete(key),
    };
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
});
