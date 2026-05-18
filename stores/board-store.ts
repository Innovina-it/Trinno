"use client";
import { createStore, useStore } from "zustand";
import {
  createContext,
  createElement,
  useContext,
  useEffect,
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
  BoardMemberRole,
  CardSubboardRow,
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
  boardMembers: BoardMemberRole[];
  workspaceProfiles: BoardProfile[];
  cardSubboards: CardSubboardRow[];
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
  boardMembers: BoardMemberRole[];
  workspaceProfiles: BoardProfile[];
  cardSubboards: CardSubboardRow[];

  upsertCardSubboard: (row: CardSubboardRow) => void;
  removeCardSubboard: (cardId: string) => void;

  // Plan #16b-γ-D (#8) — ephemeral multi-select state. Lives only on the
  // current board view; cleared on navigation by the consumer remounting
  // the provider. Last-clicked id supports shift-click range selection.
  selectedCardIds: Set<string>;
  lastSelectedCardId: string | null;
  toggleSelected: (cardId: string) => void;
  selectRangeTo: (cardId: string) => void;
  setSelected: (ids: string[]) => void;
  clearSelection: () => void;

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

  upsertBoardMember: (m: BoardMemberRole, profile?: BoardProfile) => void;
  removeBoardMember: (userId: string) => void;

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

const MAX_COMMENTS_PER_CARD = 200;

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
    boardMembers: initial.boardMembers,
    workspaceProfiles: initial.workspaceProfiles,
    cardSubboards: initial.cardSubboards,

    upsertCardSubboard: (row) =>
      set((state) => ({
        cardSubboards: state.cardSubboards.some((x) => x.cardId === row.cardId)
          ? state.cardSubboards.map((x) =>
              x.cardId === row.cardId ? row : x,
            )
          : [...state.cardSubboards, row],
      })),
    removeCardSubboard: (cardId) =>
      set((state) => ({
        cardSubboards: state.cardSubboards.filter((x) => x.cardId !== cardId),
      })),

    selectedCardIds: new Set<string>(),
    lastSelectedCardId: null,
    toggleSelected: (cardId) =>
      set((state) => {
        const next = new Set(state.selectedCardIds);
        if (next.has(cardId)) next.delete(cardId);
        else next.add(cardId);
        return { selectedCardIds: next, lastSelectedCardId: cardId };
      }),
    selectRangeTo: (cardId) =>
      set((state) => {
        // Range-select between the last-clicked card and `cardId` within
        // the same list (board-store cards are sorted by position).
        const target = state.cards.find((c) => c.id === cardId);
        if (!target) return state;
        const anchor = state.lastSelectedCardId
          ? state.cards.find((c) => c.id === state.lastSelectedCardId)
          : null;
        if (!anchor || anchor.listId !== target.listId) {
          // Fall back to a single toggle.
          const next = new Set(state.selectedCardIds);
          next.add(cardId);
          return { selectedCardIds: next, lastSelectedCardId: cardId };
        }
        const listCards = state.cards
          .filter((c) => c.listId === target.listId)
          .slice()
          .sort((a, b) => (a.position < b.position ? -1 : 1));
        const idxA = listCards.findIndex((c) => c.id === anchor.id);
        const idxB = listCards.findIndex((c) => c.id === target.id);
        if (idxA < 0 || idxB < 0) return state;
        const lo = Math.min(idxA, idxB);
        const hi = Math.max(idxA, idxB);
        const next = new Set(state.selectedCardIds);
        for (let i = lo; i <= hi; i++) next.add(listCards[i].id);
        return { selectedCardIds: next, lastSelectedCardId: cardId };
      }),
    setSelected: (ids) =>
      set(() => ({
        selectedCardIds: new Set(ids),
        lastSelectedCardId: ids[ids.length - 1] ?? null,
      })),
    clearSelection: () =>
      set(() => ({
        selectedCardIds: new Set<string>(),
        lastSelectedCardId: null,
      })),

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
        boardMembers: s.boardMembers,
        workspaceProfiles: s.workspaceProfiles,
        cardSubboards: s.cardSubboards,
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
      set((state) => {
        const selectedCardIds = new Set(state.selectedCardIds);
        selectedCardIds.delete(id);
        return {
          cards: state.cards.filter((c) => c.id !== id),
          cardLabels: state.cardLabels.filter((cl) => cl.cardId !== id),
          cardMembers: state.cardMembers.filter((cm) => cm.cardId !== id),
          checklists: state.checklists.filter((c) => c.cardId !== id),
          checklistItems: state.checklistItems.filter((i) =>
            state.checklists.some(
              (c) => c.id === i.checklistId && c.cardId !== id,
            ),
          ),
          comments: state.comments.filter((c) => c.cardId !== id),
          attachments: state.attachments.filter((a) => a.cardId !== id),
          cardLinks: state.cardLinks.filter(
            (l) => l.fromCardId !== id && l.toCardId !== id,
          ),
          cardComponents: state.cardComponents.filter((cc) => cc.cardId !== id),
          cardVersions: state.cardVersions.filter((cv) => cv.cardId !== id),
          selectedCardIds,
          lastSelectedCardId:
            state.lastSelectedCardId === id ? null : state.lastSelectedCardId,
        };
      }),

    removeList: (id) =>
      set((state) => {
        const removedCardIds = new Set(
          state.cards.filter((c) => c.listId === id).map((c) => c.id),
        );
        const removedChecklistIds = new Set(
          state.checklists
            .filter((c) => removedCardIds.has(c.cardId))
            .map((c) => c.id),
        );
        const selectedCardIds = new Set(state.selectedCardIds);
        for (const cardId of removedCardIds) selectedCardIds.delete(cardId);
        return {
          lists: state.lists.filter((l) => l.id !== id),
          cards: state.cards.filter((c) => c.listId !== id),
          cardLabels: state.cardLabels.filter(
            (cl) => !removedCardIds.has(cl.cardId),
          ),
          cardMembers: state.cardMembers.filter(
            (cm) => !removedCardIds.has(cm.cardId),
          ),
          checklists: state.checklists.filter(
            (c) => !removedCardIds.has(c.cardId),
          ),
          checklistItems: state.checklistItems.filter(
            (i) => !removedChecklistIds.has(i.checklistId),
          ),
          comments: state.comments.filter((c) => !removedCardIds.has(c.cardId)),
          attachments: state.attachments.filter(
            (a) => !removedCardIds.has(a.cardId),
          ),
          cardLinks: state.cardLinks.filter(
            (l) =>
              !removedCardIds.has(l.fromCardId) &&
              !removedCardIds.has(l.toCardId),
          ),
          cardComponents: state.cardComponents.filter(
            (cc) => !removedCardIds.has(cc.cardId),
          ),
          cardVersions: state.cardVersions.filter(
            (cv) => !removedCardIds.has(cv.cardId),
          ),
          selectedCardIds,
          lastSelectedCardId:
            state.lastSelectedCardId &&
            removedCardIds.has(state.lastSelectedCardId)
              ? null
              : state.lastSelectedCardId,
        };
      }),

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

    upsertBoardMember: (m, profile) =>
      set((state) => {
        const idx = state.boardMembers.findIndex((b) => b.userId === m.userId);
        const nextMembers =
          idx === -1
            ? [...state.boardMembers, m]
            : state.boardMembers.map((b) => (b.userId === m.userId ? m : b));
        if (!profile) return { boardMembers: nextMembers };
        const pIdx = state.boardProfiles.findIndex((p) => p.id === profile.id);
        const nextProfiles =
          pIdx === -1
            ? [...state.boardProfiles, profile]
            : state.boardProfiles.map((p) =>
                p.id === profile.id ? profile : p,
              );
        return { boardMembers: nextMembers, boardProfiles: nextProfiles };
      }),

    removeBoardMember: (userId) =>
      set((state) => ({
        boardMembers: state.boardMembers.filter((b) => b.userId !== userId),
        boardProfiles: state.boardProfiles.filter((p) => p.id !== userId),
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
      set((state) => {
        if (state.comments.some((x) => x.id === c.id)) return state;
        const merged = sortByCreatedAt([...state.comments, c]);
        // Cap per-card to the MAX_COMMENTS_PER_CARD newest entries.
        const cardComments = merged.filter((x) => x.cardId === c.cardId);
        const overflow = cardComments.length - MAX_COMMENTS_PER_CARD;
        const comments =
          overflow > 0
            ? merged.filter(
                (x) =>
                  x.cardId !== c.cardId ||
                  !cardComments.slice(0, overflow).some((o) => o.id === x.id),
              )
            : merged;
        return { comments };
      }),

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
  // Plan #workspace-routing — key the ref by boardId so navigating
  // between boards (which share the [boardId] page component) builds
  // a fresh store from the new snapshot instead of leaking the
  // previous board's lists/cards/etc.
  const ref = useRef<{ id: string; store: BoardStore } | null>(null);
  if (!ref.current || ref.current.id !== initial.boardId) {
    ref.current = {
      id: initial.boardId,
      store: createBoardStore(initial),
    };
  }
  // After a server-side mutation triggers revalidatePath, Next.js
  // re-renders this provider with a fresh `initial`. The ref-keyed
  // store survives that re-render (good — preserves optimistic local
  // edits), but membership rosters can fall out of sync. Reconcile
  // boardProfiles / boardMembers on every render: they're authoritative
  // on the server, never edited optimistically client-side outside
  // realtime, and small enough that a shallow compare is cheap.
  useEffect(() => {
    const s = ref.current?.store;
    if (!s) return;
    const cur = s.getState();
    const profilesChanged =
      cur.boardProfiles.length !== initial.boardProfiles.length ||
      cur.boardProfiles.some((p, i) => p.id !== initial.boardProfiles[i]?.id);
    const membersChanged =
      cur.boardMembers.length !== initial.boardMembers.length ||
      cur.boardMembers.some(
        (m, i) =>
          m.userId !== initial.boardMembers[i]?.userId ||
          m.role !== initial.boardMembers[i]?.role,
      );
    const wsProfilesChanged =
      cur.workspaceProfiles.length !== initial.workspaceProfiles.length ||
      cur.workspaceProfiles.some(
        (p, i) => p.id !== initial.workspaceProfiles[i]?.id,
      );
    if (profilesChanged || membersChanged || wsProfilesChanged) {
      s.setState({
        boardProfiles: initial.boardProfiles,
        boardMembers: initial.boardMembers,
        workspaceProfiles: initial.workspaceProfiles,
      });
    }
  }, [initial.boardProfiles, initial.boardMembers, initial.workspaceProfiles]);
  return createElement(
    BoardStoreContext.Provider,
    { value: ref.current.store },
    children,
  );
}

export function useBoardStore<T>(selector: (s: BoardState) => T): T {
  const store = useContext(BoardStoreContext);
  if (!store) throw new Error("BoardStoreProvider missing");
  return useStore(store, selector);
}
