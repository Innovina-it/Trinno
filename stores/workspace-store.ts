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
import { useRouter } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import type { WorkspaceSnapshot } from "@/lib/queries/workspace-snapshot";
import type { WorkspaceRole } from "@/lib/permissions/guest-guard";
import type { CardUrlLink } from "@/lib/links/types";
import { LinksRealtime } from "@/components/links/links-realtime";

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
type SubBoard = WorkspaceSnapshot["subBoards"][number];

// Plan #links — the workspace store carries the same per-card URL-link map the
// board store does, so roadmap gantt + list surfaces (which read from this
// store, not the board store) can render the per-card link diamond. Seeded
// from the snapshot (optional so older/legacy snapshot producers still
// construct a valid store) and kept live by optimistic writes + CDC echoes.
type WorkspaceSnapshotInit = WorkspaceSnapshot & {
  cardLinkByCard?: Record<string, CardUrlLink>;
};

export type WorkspaceState = {
  workspaceId: string;
  // Plan #links — the viewer's id and workspace role, surfaced from the
  // server snapshot so UI under WorkspaceStoreContext can gate owner/admin-
  // only affordances (link writes) without a server round-trip.
  viewerId: string;
  viewerRole: WorkspaceRole;
  autoAssignCreator: boolean;
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
  subBoards: SubBoard[];
  cardLinkByCard: Record<string, CardUrlLink>;
  setCardLink: (l: CardUrlLink) => void;
  removeCardLinkLocal: (cardId: string) => void;

  setSnapshot: (s: Omit<WorkspaceSnapshotInit, "workspaceId">) => void;
  // Like setSnapshot but skips collections that are already kept live by
  // per-row CDC subscriptions (cards, lists, sprints, links, members,
  // versions). Replacing those wholesale would clobber pending optimistic
  // patches (e.g. a roadmap bar drag mid-persist) with stale snapshot data.
  mergeSnapshotPreservingRealtime: (
    s: Omit<WorkspaceSnapshotInit, "workspaceId">,
  ) => void;

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

  upsertSubBoard: (sb: SubBoard) => void;
  removeSubBoard: (id: string) => void;
};

export function createWorkspaceStore(initial: WorkspaceSnapshotInit) {
  return createStore<WorkspaceState>((set) => ({
    workspaceId: initial.workspaceId,
    // Default to "" / null so older snapshot producers that predate these
    // fields still construct a valid store.
    viewerId: initial.viewerId ?? "",
    viewerRole: initial.viewerRole ?? null,
    autoAssignCreator: initial.autoAssignCreator,
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
    subBoards: initial.subBoards,
    cardLinkByCard: initial.cardLinkByCard ?? {},

    setCardLink: (l) =>
      set((state) => ({
        cardLinkByCard: { ...state.cardLinkByCard, [l.cardId]: l },
      })),
    removeCardLinkLocal: (cardId) =>
      set((state) => {
        const next = { ...state.cardLinkByCard };
        delete next[cardId];
        return { cardLinkByCard: next };
      }),

    setSnapshot: (s) =>
      set({ ...s, cardLinkByCard: s.cardLinkByCard ?? {} }),
    mergeSnapshotPreservingRealtime: (s) =>
      set((state) => ({
        autoAssignCreator: s.autoAssignCreator,
        boards: s.boards,
        components: s.components,
        cardComponents: s.cardComponents,
        workspaceProfiles: s.workspaceProfiles,
        subBoards: s.subBoards,
        // cardLinkByCard is kept live by optimistic writes + CDC echoes, so a
        // stale snapshot must not clobber a pending local link. Seed it only
        // when the incoming snapshot actually carries the field; otherwise
        // preserve the current realtime-maintained map (matching how the
        // other CDC-backed per-card collections are left untouched here).
        cardLinkByCard: s.cardLinkByCard ?? state.cardLinkByCard,
      })),

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
      set((st) => {
        const removedCardIds = new Set(
          st.cards.filter((c) => c.listId === id).map((c) => c.id),
        );
        return {
          lists: st.lists.filter((l) => l.id !== id),
          cards: st.cards.filter((c) => c.listId !== id),
          cardLinks: st.cardLinks.filter(
            (l) =>
              !removedCardIds.has(l.fromCardId) &&
              !removedCardIds.has(l.toCardId),
          ),
          cardMembers: st.cardMembers.filter(
            (m) => !removedCardIds.has(m.cardId),
          ),
          cardComponents: st.cardComponents.filter(
            (cc) => !removedCardIds.has(cc.cardId),
          ),
          cardVersions: st.cardVersions.filter(
            (cv) => !removedCardIds.has(cv.cardId),
          ),
        };
      }),

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
      set((st) => ({
        cards: st.cards.filter((c) => c.id !== id),
        cardLinks: st.cardLinks.filter(
          (l) => l.fromCardId !== id && l.toCardId !== id,
        ),
        cardMembers: st.cardMembers.filter((m) => m.cardId !== id),
        cardComponents: st.cardComponents.filter((cc) => cc.cardId !== id),
        cardVersions: st.cardVersions.filter((cv) => cv.cardId !== id),
      })),

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

    upsertSubBoard: (sb) =>
      set((st) => ({
        subBoards: st.subBoards.some((x) => x.id === sb.id)
          ? st.subBoards.map((x) => (x.id === sb.id ? sb : x))
          : [...st.subBoards, sb],
      })),
    removeSubBoard: (id) =>
      set((st) => ({
        subBoards: st.subBoards.filter((x) => x.id !== id),
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
  // Workspace roster (workspaceProfiles) is authoritative on the server
  // and not edited optimistically client-side. After invite/remove the
  // member action revalidates the workspace layout, which feeds a fresh
  // `initial` here — reconcile so pickers in the new-card dialog and
  // roadmap update without a full reload.
  useEffect(() => {
    const s = ref.current?.store;
    if (!s) return;
    const cur = s.getState();
    const changed =
      cur.workspaceProfiles.length !== initial.workspaceProfiles.length ||
      cur.workspaceProfiles.some(
        (p, i) =>
          p.id !== initial.workspaceProfiles[i]?.id ||
          p.displayName !== initial.workspaceProfiles[i]?.displayName ||
          p.avatarUrl !== initial.workspaceProfiles[i]?.avatarUrl,
      );
    if (changed) {
      s.setState({ workspaceProfiles: initial.workspaceProfiles });
    }
  }, [initial.workspaceProfiles]);

  // Plan #links — reconcile the per-card URL link map from the refreshed
  // server snapshot. The ref-keyed store survives Next.js re-renders (so
  // createWorkspaceStore's seed only runs on first mount); without this
  // effect, a peer's link add/remove that fires LinksRealtime → router.refresh
  // would feed a fresh `initial` here but never reach the live store, leaving
  // peers' diamonds stale. Server snapshot is authoritative on refresh; a
  // shallow id/color compare keeps the write cheap and avoids clobbering an
  // identical map every render.
  const initialCardLinkByCard = (initial as WorkspaceSnapshotInit)
    .cardLinkByCard;
  useEffect(() => {
    const s = ref.current?.store;
    if (!s || !initialCardLinkByCard) return;
    const cur = s.getState().cardLinkByCard;
    const curKeys = Object.keys(cur);
    const nextKeys = Object.keys(initialCardLinkByCard);
    const changed =
      curKeys.length !== nextKeys.length ||
      nextKeys.some((k) => {
        const a = cur[k];
        const b = initialCardLinkByCard[k];
        return !a || a.id !== b.id || a.url !== b.url || a.color !== b.color;
      });
    if (changed) {
      s.setState({ cardLinkByCard: initialCardLinkByCard });
    }
  }, [initialCardLinkByCard]);

  // Subscribe to workspace_members CDC so any page hosting this provider
  // (roadmap, backlog, all-tasks, dashboards, board layout) picks up
  // invites/removals without waiting for a manual refresh. router.refresh
  // re-runs the server component, which feeds a fresh snapshot into the
  // reconciler above. Realtime publication added in migration 0076.
  const router = useRouter();
  useEffect(() => {
    const workspaceId = initial.workspaceId;
    if (!workspaceId) return;
    const supa = createSupabaseBrowser();
    let cancelled = false;
    let channel: ReturnType<typeof supa.channel> | null = null;
    // Supabase JS caches channels by name. Under React StrictMode the
    // effect runs twice: cleanup removes the channel but the second
    // mount can race and receive a still-subscribed handle, then
    // `.on()` after `.subscribe()` fails. Per-mount nonce guarantees
    // a fresh channel every time.
    const nonce = Math.random().toString(36).slice(2, 8);
    (async () => {
      const { data } = await supa.auth.getSession();
      const token = data.session?.access_token;
      if (token) await supa.realtime.setAuth(token);
      if (cancelled) return;
      channel = supa
        .channel(`ws_roster:${workspaceId}:${nonce}`)
        .on(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          "postgres_changes" as any,
          {
            event: "*",
            schema: "public",
            table: "workspace_members",
            filter: `workspace_id=eq.${workspaceId}`,
          },
          () => router.refresh(),
        )
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (channel) supa.removeChannel(channel);
    };
  }, [initial.workspaceId, router]);

  return createElement(
    WorkspaceStoreContext.Provider,
    { value: ref.current.store },
    createElement(LinksRealtime, { workspaceId: initial.workspaceId }),
    children,
  );
}

export function useWorkspaceStore<T>(selector: (s: WorkspaceState) => T): T {
  const store = useContext(WorkspaceStoreContext);
  if (!store) throw new Error("WorkspaceStoreProvider missing");
  return useStore(store, selector);
}
