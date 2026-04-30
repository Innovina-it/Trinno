"use client";
import { createStore, useStore } from "zustand";
import {
  createContext,
  createElement,
  useContext,
  useRef,
  type ReactNode,
} from "react";
import type {
  ListRow,
  CardRow,
  LabelRow,
  CardLabelRow,
  CardMemberRow,
  ChecklistRow,
  ChecklistItemRow,
  CommentRow,
  AttachmentRow,
  CardLinkRow,
  ComponentRow,
  CardComponentRow,
  CardVersionRow,
  BoardProfile,
} from "@/lib/queries/board-snapshot";

export type BoardSnapshotInit = {
  boardId: string;
  lists: ListRow[];
  cards: CardRow[];
  labels: LabelRow[];
  cardLabels: CardLabelRow[];
  cardMembers: CardMemberRow[];
  checklists: ChecklistRow[];
  checklistItems: ChecklistItemRow[];
  comments: CommentRow[];
  attachments: AttachmentRow[];
  cardLinks: CardLinkRow[];
  components: ComponentRow[];
  cardComponents: CardComponentRow[];
  cardVersions: CardVersionRow[];
  boardProfiles: BoardProfile[];
};

export type BoardState = {
  boardId: string;
  lists: ListRow[];
  cards: CardRow[];
  labels: LabelRow[];
  cardLabels: CardLabelRow[];
  cardMembers: CardMemberRow[];
  checklists: ChecklistRow[];
  checklistItems: ChecklistItemRow[];
  comments: CommentRow[];
  attachments: AttachmentRow[];
  cardLinks: CardLinkRow[];
  components: ComponentRow[];
  cardComponents: CardComponentRow[];
  cardVersions: CardVersionRow[];
  boardProfiles: BoardProfile[];

  setSnapshot: (s: Omit<BoardSnapshotInit, "boardId">) => void;

  addList: (list: ListRow) => void;
  addCard: (card: CardRow) => void;
  updateCard: (id: string, patch: Partial<CardRow>) => void;
  moveCard: (id: string, listId: string, position: string) => void;
  moveList: (id: string, position: string) => void;
  renameList: (id: string, title: string) => void;
  updateList: (id: string, patch: Partial<ListRow>) => void;
  removeCard: (id: string) => void;
  removeList: (id: string) => void;

  addLabel: (l: LabelRow) => void;
  updateLabel: (id: string, patch: Partial<LabelRow>) => void;
  removeLabel: (id: string) => void;

  addCardLabel: (x: CardLabelRow) => void;
  removeCardLabel: (cardId: string, labelId: string) => void;

  addCardMember: (x: CardMemberRow) => void;
  removeCardMember: (cardId: string, userId: string) => void;

  addChecklist: (c: ChecklistRow) => void;
  updateChecklist: (id: string, patch: Partial<ChecklistRow>) => void;
  removeChecklist: (id: string) => void;

  addChecklistItem: (i: ChecklistItemRow) => void;
  updateChecklistItem: (id: string, patch: Partial<ChecklistItemRow>) => void;
  removeChecklistItem: (id: string) => void;

  addComment: (c: CommentRow) => void;
  updateComment: (id: string, patch: Partial<CommentRow>) => void;
  removeComment: (id: string) => void;

  addAttachment: (a: AttachmentRow) => void;
  removeAttachment: (id: string) => void;

  addCardLink: (l: CardLinkRow) => void;
  removeCardLink: (id: string) => void;

  addComponent: (c: ComponentRow) => void;
  updateComponent: (id: string, patch: Partial<ComponentRow>) => void;
  removeComponent: (id: string) => void;

  addCardComponent: (x: CardComponentRow) => void;
  removeCardComponent: (cardId: string, componentId: string) => void;

  addCardVersion: (x: CardVersionRow) => void;
  removeCardVersion: (
    cardId: string,
    versionId: string,
    kind: CardVersionRow["kind"],
  ) => void;
};

function sortByPosition<T extends { position: string }>(rows: T[]): T[] {
  return rows.slice().sort((a, b) => (a.position < b.position ? -1 : 1));
}

function sortByCreatedAt<T extends { createdAt: Date }>(rows: T[]): T[] {
  return rows
    .slice()
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export function createBoardStore(initial: BoardSnapshotInit) {
  return createStore<BoardState>((set) => ({
    boardId: initial.boardId,
    lists: sortByPosition(initial.lists),
    cards: sortByPosition(initial.cards),
    labels: initial.labels,
    cardLabels: initial.cardLabels,
    cardMembers: initial.cardMembers,
    checklists: sortByPosition(initial.checklists),
    checklistItems: sortByPosition(initial.checklistItems),
    comments: sortByCreatedAt(initial.comments),
    attachments: initial.attachments,
    cardLinks: initial.cardLinks,
    components: initial.components,
    cardComponents: initial.cardComponents,
    cardVersions: initial.cardVersions,
    boardProfiles: initial.boardProfiles,

    setSnapshot: (s) =>
      set({
        lists: sortByPosition(s.lists),
        cards: sortByPosition(s.cards),
        labels: s.labels,
        cardLabels: s.cardLabels,
        cardMembers: s.cardMembers,
        checklists: sortByPosition(s.checklists),
        checklistItems: sortByPosition(s.checklistItems),
        comments: sortByCreatedAt(s.comments),
        attachments: s.attachments,
        cardLinks: s.cardLinks,
        components: s.components,
        cardComponents: s.cardComponents,
        cardVersions: s.cardVersions,
        boardProfiles: s.boardProfiles,
      }),

    addList: (list) =>
      set((state) =>
        state.lists.some((l) => l.id === list.id)
          ? state
          : { lists: sortByPosition([...state.lists, list]) },
      ),

    addCard: (card) =>
      set((state) =>
        state.cards.some((c) => c.id === card.id)
          ? state
          : { cards: sortByPosition([...state.cards, card]) },
      ),

    updateCard: (id, patch) =>
      set((state) => ({
        cards: state.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      })),

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

    updateList: (id, patch) =>
      set((state) => ({
        lists: state.lists.map((l) => (l.id === id ? { ...l, ...patch } : l)),
      })),

    removeCard: (id) =>
      set((state) => ({ cards: state.cards.filter((c) => c.id !== id) })),

    removeList: (id) =>
      set((state) => ({
        lists: state.lists.filter((l) => l.id !== id),
        cards: state.cards.filter((c) => c.listId !== id),
      })),

    addLabel: (l) =>
      set((state) =>
        state.labels.some((x) => x.id === l.id)
          ? state
          : { labels: [...state.labels, l] },
      ),

    updateLabel: (id, patch) =>
      set((state) => ({
        labels: state.labels.map((l) => (l.id === id ? { ...l, ...patch } : l)),
      })),

    removeLabel: (id) =>
      set((state) => ({
        labels: state.labels.filter((l) => l.id !== id),
        cardLabels: state.cardLabels.filter((cl) => cl.labelId !== id),
      })),

    addCardLabel: (x) =>
      set((state) =>
        state.cardLabels.some(
          (cl) => cl.cardId === x.cardId && cl.labelId === x.labelId,
        )
          ? state
          : { cardLabels: [...state.cardLabels, x] },
      ),

    removeCardLabel: (cardId, labelId) =>
      set((state) => ({
        cardLabels: state.cardLabels.filter(
          (cl) => !(cl.cardId === cardId && cl.labelId === labelId),
        ),
      })),

    addCardMember: (x) =>
      set((state) =>
        state.cardMembers.some(
          (cm) => cm.cardId === x.cardId && cm.userId === x.userId,
        )
          ? state
          : { cardMembers: [...state.cardMembers, x] },
      ),

    removeCardMember: (cardId, userId) =>
      set((state) => ({
        cardMembers: state.cardMembers.filter(
          (cm) => !(cm.cardId === cardId && cm.userId === userId),
        ),
      })),

    addChecklist: (c) =>
      set((state) =>
        state.checklists.some((x) => x.id === c.id)
          ? state
          : { checklists: sortByPosition([...state.checklists, c]) },
      ),

    updateChecklist: (id, patch) =>
      set((state) => ({
        checklists: sortByPosition(
          state.checklists.map((c) =>
            c.id === id ? { ...c, ...patch } : c,
          ),
        ),
      })),

    removeChecklist: (id) =>
      set((state) => ({
        checklists: state.checklists.filter((c) => c.id !== id),
        checklistItems: state.checklistItems.filter(
          (i) => i.checklistId !== id,
        ),
      })),

    addChecklistItem: (i) =>
      set((state) =>
        state.checklistItems.some((x) => x.id === i.id)
          ? state
          : { checklistItems: sortByPosition([...state.checklistItems, i]) },
      ),

    updateChecklistItem: (id, patch) =>
      set((state) => ({
        checklistItems: sortByPosition(
          state.checklistItems.map((i) =>
            i.id === id ? { ...i, ...patch } : i,
          ),
        ),
      })),

    removeChecklistItem: (id) =>
      set((state) => ({
        checklistItems: state.checklistItems.filter((i) => i.id !== id),
      })),

    addComment: (c) =>
      set((state) =>
        state.comments.some((x) => x.id === c.id)
          ? state
          : { comments: sortByCreatedAt([...state.comments, c]) },
      ),

    updateComment: (id, patch) =>
      set((state) => ({
        comments: state.comments.map((c) =>
          c.id === id ? { ...c, ...patch } : c,
        ),
      })),

    removeComment: (id) =>
      set((state) => ({
        comments: state.comments.filter((c) => c.id !== id),
      })),

    addAttachment: (a) =>
      set((state) =>
        state.attachments.some((x) => x.id === a.id)
          ? state
          : { attachments: [...state.attachments, a] },
      ),

    removeAttachment: (id) =>
      set((state) => ({
        attachments: state.attachments.filter((a) => a.id !== id),
      })),

    addCardLink: (l) =>
      set((state) =>
        state.cardLinks.some((x) => x.id === l.id)
          ? state
          : { cardLinks: [...state.cardLinks, l] },
      ),

    removeCardLink: (id) =>
      set((state) => ({
        cardLinks: state.cardLinks.filter((l) => l.id !== id),
      })),

    addComponent: (c) =>
      set((state) =>
        state.components.some((x) => x.id === c.id)
          ? state
          : { components: [...state.components, c] },
      ),

    updateComponent: (id, patch) =>
      set((state) => ({
        components: state.components.map((c) =>
          c.id === id ? { ...c, ...patch } : c,
        ),
      })),

    removeComponent: (id) =>
      set((state) => ({
        components: state.components.filter((c) => c.id !== id),
        cardComponents: state.cardComponents.filter(
          (cc) => cc.componentId !== id,
        ),
      })),

    addCardComponent: (x) =>
      set((state) =>
        state.cardComponents.some(
          (cc) =>
            cc.cardId === x.cardId && cc.componentId === x.componentId,
        )
          ? state
          : { cardComponents: [...state.cardComponents, x] },
      ),

    removeCardComponent: (cardId, componentId) =>
      set((state) => ({
        cardComponents: state.cardComponents.filter(
          (cc) => !(cc.cardId === cardId && cc.componentId === componentId),
        ),
      })),

    addCardVersion: (x) =>
      set((state) =>
        state.cardVersions.some(
          (cv) =>
            cv.cardId === x.cardId &&
            cv.versionId === x.versionId &&
            cv.kind === x.kind,
        )
          ? state
          : { cardVersions: [...state.cardVersions, x] },
      ),

    removeCardVersion: (cardId, versionId, kind) =>
      set((state) => ({
        cardVersions: state.cardVersions.filter(
          (cv) =>
            !(
              cv.cardId === cardId &&
              cv.versionId === versionId &&
              cv.kind === kind
            ),
        ),
      })),
  }));
}

export type BoardStore = ReturnType<typeof createBoardStore>;

export const BoardStoreContext = createContext<BoardStore | null>(null);

export function BoardStoreProvider({
  initial,
  children,
}: {
  initial: BoardSnapshotInit;
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
