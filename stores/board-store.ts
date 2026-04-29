"use client";
import { create } from "zustand";
import type { BoardSnapshot } from "@/lib/queries/board-data";

type ListT = BoardSnapshot["lists"][number];
type CardT = BoardSnapshot["cards"][number];

type State = {
  boardId: string;
  lists: Record<string, ListT>;
  cards: Record<string, CardT>;
  listOrder: string[];
  cardOrderByList: Record<string, string[]>;

  setSnapshot: (snap: BoardSnapshot) => void;
  applyMoveCard: (
    cardId: string,
    toListId: string,
    newPosition: string,
  ) => void;
  applyMoveList: (listId: string, newPosition: string) => void;
  applyAddList: (list: ListT) => void;
  applyAddCard: (card: CardT) => void;
  applyUpdateCard: (id: string, patch: Partial<CardT>) => void;
};

export const useBoardStore = create<State>((set, get) => ({
  boardId: "",
  lists: {},
  cards: {},
  listOrder: [],
  cardOrderByList: {},

  setSnapshot(snap) {
    const lists: Record<string, ListT> = {};
    const cards: Record<string, CardT> = {};
    const cardOrderByList: Record<string, string[]> = {};
    for (const l of snap.lists) lists[l.id] = l;
    for (const c of snap.cards) {
      cards[c.id] = c;
      (cardOrderByList[c.listId] ??= []).push(c.id);
    }
    set({
      boardId: snap.board.id,
      lists,
      cards,
      cardOrderByList,
      listOrder: snap.lists.filter((l) => !l.archived).map((l) => l.id),
    });
  },

  applyMoveCard(cardId, toListId, newPosition) {
    const { cards, cardOrderByList } = get();
    const card = cards[cardId];
    if (!card) return;
    const fromList = card.listId;
    const newCards = {
      ...cards,
      [cardId]: { ...card, listId: toListId, position: newPosition },
    };
    const newOrder = { ...cardOrderByList };
    newOrder[fromList] = (newOrder[fromList] ?? []).filter(
      (id) => id !== cardId,
    );
    const target = (newOrder[toListId] ?? []).filter((id) => id !== cardId);
    target.push(cardId);
    target.sort((a, b) =>
      newCards[a].position < newCards[b].position ? -1 : 1,
    );
    newOrder[toListId] = target;
    set({ cards: newCards, cardOrderByList: newOrder });
  },

  applyMoveList(listId, newPosition) {
    const { lists, listOrder } = get();
    if (!lists[listId]) return;
    const newLists = {
      ...lists,
      [listId]: { ...lists[listId], position: newPosition },
    };
    const newOrder = listOrder
      .slice()
      .sort((a, b) => (newLists[a].position < newLists[b].position ? -1 : 1));
    set({ lists: newLists, listOrder: newOrder });
  },

  applyAddList(list) {
    const { lists, listOrder, cardOrderByList } = get();
    set({
      lists: { ...lists, [list.id]: list },
      listOrder: [...listOrder, list.id],
      cardOrderByList: { ...cardOrderByList, [list.id]: [] },
    });
  },

  applyAddCard(card) {
    const { cards, cardOrderByList } = get();
    set({
      cards: { ...cards, [card.id]: card },
      cardOrderByList: {
        ...cardOrderByList,
        [card.listId]: [...(cardOrderByList[card.listId] ?? []), card.id],
      },
    });
  },

  applyUpdateCard(id, patch) {
    const { cards } = get();
    if (!cards[id]) return;
    set({ cards: { ...cards, [id]: { ...cards[id], ...patch } } });
  },
}));
