"use client";
import { createStore, useStore } from "zustand";
import {
  createContext,
  createElement,
  useContext,
  useRef,
  type ReactNode,
} from "react";
import type { ListRow, CardRow } from "@/lib/queries/board-snapshot";

export type BoardState = {
  boardId: string;
  lists: ListRow[];
  cards: CardRow[];
  setSnapshot: (s: { lists: ListRow[]; cards: CardRow[] }) => void;
  addList: (list: ListRow) => void;
  addCard: (card: CardRow) => void;
  moveCard: (id: string, listId: string, position: string) => void;
  moveList: (id: string, position: string) => void;
  renameList: (id: string, title: string) => void;
  removeCard: (id: string) => void;
  removeList: (id: string) => void;
};

function sortByPosition<T extends { position: string }>(rows: T[]): T[] {
  return rows.slice().sort((a, b) => (a.position < b.position ? -1 : 1));
}

export function createBoardStore(initial: {
  boardId: string;
  lists: ListRow[];
  cards: CardRow[];
}) {
  return createStore<BoardState>((set) => ({
    boardId: initial.boardId,
    lists: sortByPosition(initial.lists),
    cards: sortByPosition(initial.cards),

    setSnapshot: (s) =>
      set({
        lists: sortByPosition(s.lists),
        cards: sortByPosition(s.cards),
      }),

    addList: (list) =>
      set((state) => ({ lists: sortByPosition([...state.lists, list]) })),

    addCard: (card) =>
      set((state) => ({ cards: sortByPosition([...state.cards, card]) })),

    moveCard: (id, listId, position) =>
      set((state) => ({
        cards: sortByPosition(
          state.cards.map((c) =>
            c.id === id ? { ...c, listId, position } : c,
          ),
        ),
      })),

    moveList: (id, position) =>
      set((state) => ({
        lists: sortByPosition(
          state.lists.map((l) => (l.id === id ? { ...l, position } : l)),
        ),
      })),

    renameList: (id, title) =>
      set((state) => ({
        lists: state.lists.map((l) => (l.id === id ? { ...l, title } : l)),
      })),

    removeCard: (id) =>
      set((state) => ({ cards: state.cards.filter((c) => c.id !== id) })),

    removeList: (id) =>
      set((state) => ({
        lists: state.lists.filter((l) => l.id !== id),
        cards: state.cards.filter((c) => c.listId !== id),
      })),
  }));
}

export type BoardStore = ReturnType<typeof createBoardStore>;

export const BoardStoreContext = createContext<BoardStore | null>(null);

export function BoardStoreProvider({
  initial,
  children,
}: {
  initial: { boardId: string; lists: ListRow[]; cards: CardRow[] };
  children: ReactNode;
}) {
  const ref = useRef<BoardStore | null>(null);
  if (!ref.current) ref.current = createBoardStore(initial);
  return createElement(
    BoardStoreContext.Provider,
    { value: ref.current },
    children,
  );
}

export function useBoardStore<T>(selector: (s: BoardState) => T): T {
  const store = useContext(BoardStoreContext);
  if (!store) throw new Error("BoardStoreProvider missing");
  return useStore(store, selector);
}
