// @vitest-environment jsdom
//
// Regression: the card quick view's link diamond vanished when the SAME card
// was opened from the roadmap. The board mounts the qv under a
// BoardStoreProvider; the roadmap mounts it under only the
// WorkspaceStoreProvider. useQuickViewCardLink originally read link state ONLY
// from BoardStoreContext, so on the roadmap `link` was undefined and the
// LinkIcon fell back to the "add link" chain even though the link existed
// (and the roadmap BAR — which reads s.cardLinkByCard — still showed it).
//
// These tests pin the store-resolution contract: prefer the board store, fall
// back to the workspace store. Both stores are stubbed to the minimal shape
// the hook touches (subscribe + getState().cardLinkByCard/setters).
import { describe, it, expect, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook } from "@testing-library/react";

import { BoardStoreContext } from "@/stores/board-store";
import { WorkspaceStoreContext } from "@/stores/workspace-store";
import type { CardUrlLink } from "@/lib/links/types";
import { useQuickViewCardLink } from "@/components/board/use-quick-view-card-link";

const CARD_ID = "card-1";

function link(url: string): CardUrlLink {
  return { id: "link-1", cardId: CARD_ID, url, color: "#3b82f6", status: null };
}

// Minimal stand-in for the zustand StoreApi surface the hook uses. Cast at the
// provider boundary since the hook only ever calls subscribe + getState.
function fakeStore(cardLink: CardUrlLink | undefined) {
  const state = {
    cardLinkByCard: cardLink ? { [CARD_ID]: cardLink } : {},
    setCardLink: vi.fn(),
    removeCardLinkLocal: vi.fn(),
  };
  return { subscribe: () => () => {}, getState: () => state, _state: state };
}

function wrapper(opts: {
  board?: ReturnType<typeof fakeStore>;
  workspace?: ReturnType<typeof fakeStore>;
}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    let tree = children;
    if (opts.workspace) {
      tree = createElement(
        WorkspaceStoreContext.Provider,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { value: opts.workspace as any },
        tree,
      );
    }
    if (opts.board) {
      tree = createElement(
        BoardStoreContext.Provider,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { value: opts.board as any },
        tree,
      );
    }
    return tree;
  };
}

describe("useQuickViewCardLink store resolution", () => {
  it("reads the link from the workspace store when no board store is present (roadmap)", () => {
    const workspace = fakeStore(link("drive.google.com/x"));
    const { result } = renderHook(() => useQuickViewCardLink(CARD_ID), {
      wrapper: wrapper({ workspace }),
    });
    // This is the bug fix: previously undefined → chain instead of diamond.
    expect(result.current.link?.url).toBe("drive.google.com/x");
  });

  it("prefers the board store when both stores are present (board view)", () => {
    const board = fakeStore(link("board-url"));
    const workspace = fakeStore(link("workspace-url"));
    const { result } = renderHook(() => useQuickViewCardLink(CARD_ID), {
      wrapper: wrapper({ board, workspace }),
    });
    expect(result.current.link?.url).toBe("board-url");
  });

  it("routes setters to the workspace store on the roadmap", () => {
    const workspace = fakeStore(undefined);
    const { result } = renderHook(() => useQuickViewCardLink(CARD_ID), {
      wrapper: wrapper({ workspace }),
    });
    const l = link("https://example.com/doc");
    result.current.setCardLink(l);
    result.current.removeCardLinkLocal(CARD_ID);
    expect(workspace._state.setCardLink).toHaveBeenCalledWith(l);
    expect(workspace._state.removeCardLinkLocal).toHaveBeenCalledWith(CARD_ID);
  });

  it("returns undefined link and no-op setters with neither store (defensive)", () => {
    const { result } = renderHook(() => useQuickViewCardLink(CARD_ID), {
      wrapper: wrapper({}),
    });
    expect(result.current.link).toBeUndefined();
    // Must not throw when no store is mounted.
    expect(() => result.current.setCardLink(link("x"))).not.toThrow();
    expect(() => result.current.removeCardLinkLocal(CARD_ID)).not.toThrow();
  });
});
