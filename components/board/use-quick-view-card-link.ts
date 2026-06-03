"use client";
import { useCallback, useContext, useSyncExternalStore } from "react";

import { BoardStoreContext } from "@/stores/board-store";
import { WorkspaceStoreContext } from "@/stores/workspace-store";
import type { CardUrlLink } from "@/lib/links/types";

/**
 * Card-scoped URL link state for the card quick view. Subscribes via
 * useSyncExternalStore (same idiom as useQuickViewSubboardContext) so the
 * chain/diamond reflects optimistic + server-confirmed link state.
 *
 * The board view supplies a BoardStoreProvider; the roadmap mounts the qv
 * under only the WorkspaceStoreProvider. Both stores expose an identical
 * cardLinkByCard map + setters (seeded server-side and kept live by
 * LinksRealtime — the roadmap bar already reads s.cardLinkByCard the same
 * way), so we prefer the board store when present and fall back to the
 * workspace store. Without the fallback the diamond silently degrades to the
 * "add link" chain on the roadmap qv even though the link exists.
 */
export function useQuickViewCardLink(cardId: string): {
  link: CardUrlLink | undefined;
  setCardLink: (l: CardUrlLink) => void;
  removeCardLinkLocal: (cardId: string) => void;
} {
  const boardStore = useContext(BoardStoreContext);
  const workspaceStore = useContext(WorkspaceStoreContext);
  const store = boardStore ?? workspaceStore;
  const subscribe = useCallback(
    (cb: () => void) => store?.subscribe(cb) ?? (() => {}),
    [store],
  );
  const getLink = useCallback(
    () => store?.getState().cardLinkByCard[cardId],
    [store, cardId],
  );
  const link = useSyncExternalStore(subscribe, getLink, getLink);
  const setCardLink = useCallback(
    (l: CardUrlLink) => store?.getState().setCardLink(l),
    [store],
  );
  const removeCardLinkLocal = useCallback(
    (id: string) => store?.getState().removeCardLinkLocal(id),
    [store],
  );
  return { link, setCardLink, removeCardLinkLocal };
}
