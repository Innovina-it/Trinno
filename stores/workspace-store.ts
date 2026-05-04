"use client";
import { createStore, useStore } from "zustand";
import {
  createContext,
  createElement,
  useContext,
  useRef,
  type ReactNode,
} from "react";
import type { WorkspaceSnapshot } from "@/lib/queries/workspace-snapshot";

// Plan #16b-β — per-workspace zustand store. Mirrors the BoardStoreProvider
// context pattern but scopes to a workspace, so cross-board views (Roadmap,
// Backlog, workspace-bound Dashboards) share state and CDC echoes.
//
// The per-board store at `stores/board-store.ts` is unchanged — Kanban-style
// board views keep using it for list / label / checklist / comment data
// that doesn't travel across boards.

type Card = WorkspaceSnapshot["cards"][number];
type List = WorkspaceSnapshot["lists"][number];
type Sprint = WorkspaceSnapshot["sprints"][number];
type Component = WorkspaceSnapshot["components"][number];
type CardComponent = WorkspaceSnapshot["cardComponents"][number];
type Version = WorkspaceSnapshot["versions"][number];
type CardVersion = WorkspaceSnapshot["cardVersions"][number];
type CardLink = WorkspaceSnapshot["cardLinks"][number];
type CardMember = WorkspaceSnapshot["cardMembers"][number];
type Profile = WorkspaceSnapshot["workspaceProfiles"][number];
type Board = WorkspaceSnapshot["boards"][number];

export type WorkspaceState = {
  workspaceId: string;
  boards: Board[];
  lists: List[];
  cards: Card[];
  sprints: Sprint[];
  components: Component[];
  cardComponents: CardComponent[];
  versions: Version[];
  cardVersions: CardVersion[];
  cardLinks: CardLink[];
  cardMembers: CardMember[];
  workspaceProfiles: Profile[];

  setSnapshot: (s: Omit<WorkspaceSnapshot, "workspaceId">) => void;

  upsertList: (l: List) => void;
  patchList: (id: string, patch: Partial<List>) => void;
  removeList: (id: string) => void;

  upsertCard: (c: Card) => void;
  patchCard: (id: string, patch: Partial<Card>) => void;
  removeCard: (id: string) => void;

  upsertSprint: (s: Sprint) => void;
  patchSprint: (id: string, patch: Partial<Sprint>) => void;
  removeSprint: (id: string) => void;

  upsertVersion: (v: Version) => void;
  patchVersion: (id: string, patch: Partial<Version>) => void;
  removeVersion: (id: string) => void;

  upsertCardLink: (l: CardLink) => void;
  removeCardLink: (id: string) => void;

  upsertCardMember: (m: CardMember) => void;
  removeCardMember: (cardId: string, userId: string) => void;

  upsertCardVersion: (x: CardVersion) => void;
  removeCardVersion: (
    cardId: string,
    versionId: string,
    kind: string,
  ) => void;
};

export function createWorkspaceStore(initial: WorkspaceSnapshot) {
  return createStore<WorkspaceState>((set) => ({
    workspaceId: initial.workspaceId,
    boards: initial.boards,
    lists: initial.lists,
    cards: initial.cards,
    sprints: initial.sprints,
    components: initial.components,
    cardComponents: initial.cardComponents,
    versions: initial.versions,
    cardVersions: initial.cardVersions,
    cardLinks: initial.cardLinks,
    cardMembers: initial.cardMembers,
    workspaceProfiles: initial.workspaceProfiles,

    setSnapshot: (s) => set({ ...s }),

    upsertList: (l) =>
      set((st) => ({
        lists: st.lists.some((x) => x.id === l.id)
          ? st.lists.map((x) => (x.id === l.id ? { ...x, ...l } : x))
          : [...st.lists, l],
      })),
    patchList: (id, patch) =>
      set((st) => ({
        lists: st.lists.map((l) => (l.id === id ? { ...l, ...patch } : l)),
      })),
    removeList: (id) =>
      set((st) => ({ lists: st.lists.filter((l) => l.id !== id) })),

    upsertCard: (c) =>
      set((st) => ({
        cards: st.cards.some((x) => x.id === c.id)
          ? st.cards.map((x) => (x.id === c.id ? { ...x, ...c } : x))
          : [...st.cards, c],
      })),
    patchCard: (id, patch) =>
      set((st) => ({
        cards: st.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      })),
    removeCard: (id) =>
      set((st) => ({ cards: st.cards.filter((c) => c.id !== id) })),

    upsertSprint: (s) =>
      set((st) => ({
        sprints: st.sprints.some((x) => x.id === s.id)
          ? st.sprints.map((x) => (x.id === s.id ? { ...x, ...s } : x))
          : [...st.sprints, s],
      })),
    patchSprint: (id, patch) =>
      set((st) => ({
        sprints: st.sprints.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      })),
    removeSprint: (id) =>
      set((st) => ({ sprints: st.sprints.filter((s) => s.id !== id) })),

    upsertVersion: (v) =>
      set((st) => ({
        versions: st.versions.some((x) => x.id === v.id)
          ? st.versions.map((x) => (x.id === v.id ? { ...x, ...v } : x))
          : [...st.versions, v],
      })),
    patchVersion: (id, patch) =>
      set((st) => ({
        versions: st.versions.map((v) =>
          v.id === id ? { ...v, ...patch } : v,
        ),
      })),
    removeVersion: (id) =>
      set((st) => ({ versions: st.versions.filter((v) => v.id !== id) })),

    upsertCardLink: (l) =>
      set((st) => ({
        cardLinks: st.cardLinks.some((x) => x.id === l.id)
          ? st.cardLinks
          : [...st.cardLinks, l],
      })),
    removeCardLink: (id) =>
      set((st) => ({
        cardLinks: st.cardLinks.filter((l) => l.id !== id),
      })),

    upsertCardMember: (m) =>
      set((st) => ({
        cardMembers: st.cardMembers.some(
          (x) => x.cardId === m.cardId && x.userId === m.userId,
        )
          ? st.cardMembers
          : [...st.cardMembers, m],
      })),
    removeCardMember: (cardId, userId) =>
      set((st) => ({
        cardMembers: st.cardMembers.filter(
          (m) => !(m.cardId === cardId && m.userId === userId),
        ),
      })),

    upsertCardVersion: (x) =>
      set((st) => ({
        cardVersions: st.cardVersions.some(
          (cv) =>
            cv.cardId === x.cardId &&
            cv.versionId === x.versionId &&
            cv.kind === x.kind,
        )
          ? st.cardVersions
          : [...st.cardVersions, x],
      })),
    removeCardVersion: (cardId, versionId, kind) =>
      set((st) => ({
        cardVersions: st.cardVersions.filter(
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

export type WorkspaceStore = ReturnType<typeof createWorkspaceStore>;

export const WorkspaceStoreContext = createContext<WorkspaceStore | null>(
  null,
);

export function WorkspaceStoreProvider({
  initial,
  children,
}: {
  initial: WorkspaceSnapshot;
  children: ReactNode;
}) {
  // Plan #workspace-routing — keep a ref keyed by workspaceId so when
  // the user navigates between workspaces (the same React tree slot
  // is reused by Next.js because [workspaceId] route segments share
  // the page component), we recreate the store with the fresh
  // snapshot instead of leaking the previous workspace's data.
  const ref = useRef<{ id: string; store: WorkspaceStore } | null>(null);
  if (!ref.current || ref.current.id !== initial.workspaceId) {
    ref.current = {
      id: initial.workspaceId,
      store: createWorkspaceStore(initial),
    };
  }
  return createElement(
    WorkspaceStoreContext.Provider,
    { value: ref.current.store },
    children,
  );
}

export function useWorkspaceStore<T>(selector: (s: WorkspaceState) => T): T {
  const store = useContext(WorkspaceStoreContext);
  if (!store) throw new Error("WorkspaceStoreProvider missing");
  return useStore(store, selector);
}
