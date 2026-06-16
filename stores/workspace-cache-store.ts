"use client";

import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { QueryClient, type Updater } from "@tanstack/react-query";

// Backed by a real TanStack Query `QueryClient`. This module keeps the
// historical export surface (`WorkspaceQueryClient`, `fetchQuery`, hydration,
// `invalidateQueries`) as a thin adapter so the existing call sites and the
// shared-cache tests keep working unchanged. The previous hand-rolled
// Map/notify engine has been removed in favour of TanStack's QueryCache.
//
// Defaults pin gcTime/staleTime to Infinity so server-hydrated snapshots
// persist (no observer-based garbage collection) and stay fresh until an
// explicit `invalidateQueries` — matching the prior in-memory behaviour.
export type WorkspaceQueryKey = readonly unknown[];

export type WorkspaceCacheEntry<T = unknown> = {
  queryKey: WorkspaceQueryKey;
  data: T;
  updatedAt: number;
};

export type DehydratedWorkspaceCache = {
  queries: WorkspaceCacheEntry[];
};

type QueryFn<T> = () => Promise<T>;

function createInnerClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: Infinity,
        staleTime: Infinity,
      },
    },
  });
}

export class WorkspaceQueryClient {
  private client: QueryClient;

  constructor(state?: DehydratedWorkspaceCache) {
    this.client = createInnerClient();
    this.hydrate(state);
  }

  hydrate(state?: DehydratedWorkspaceCache) {
    if (!state) return;
    for (const entry of state.queries) {
      this.client.setQueryData(entry.queryKey as unknown[], entry.data);
    }
  }

  dehydrate(): DehydratedWorkspaceCache {
    return {
      queries: this.client
        .getQueryCache()
        .getAll()
        .map((query) => ({
          queryKey: query.queryKey as WorkspaceQueryKey,
          data: query.state.data,
          updatedAt: query.state.dataUpdatedAt,
        })),
    };
  }

  getQueryData<T>(queryKey: WorkspaceQueryKey): T | undefined {
    return this.client.getQueryData<T>(queryKey as unknown[]);
  }

  setQueryData<T>(
    queryKey: WorkspaceQueryKey,
    updater: T | ((current: T | undefined) => T),
  ): T {
    return this.client.setQueryData<T>(
      queryKey as unknown[],
      updater as Updater<T | undefined, T | undefined>,
    ) as T;
  }

  async fetchQuery<T>({
    queryKey,
    queryFn,
    force = false,
  }: {
    queryKey: WorkspaceQueryKey;
    queryFn: QueryFn<T>;
    force?: boolean;
  }): Promise<T> {
    return this.client.fetchQuery<T>({
      queryKey: queryKey as unknown[],
      queryFn,
      // Infinity = serve the cached value when present; 0 = always refetch.
      staleTime: force ? 0 : Infinity,
    });
  }

  async invalidateQueries({
    queryKey,
  }: {
    queryKey: WorkspaceQueryKey;
  }): Promise<void> {
    // Default partial matching invalidates every query whose key starts with
    // this prefix; `refetchType: "all"` refetches them (including inactive,
    // observer-less queries) using their stored queryFn — mirroring the old
    // engine which re-ran the stored fetcher for each stale prefix match.
    await this.client.invalidateQueries({
      queryKey: queryKey as unknown[],
      refetchType: "all",
    });
  }

  subscribe(listener: () => void): () => void {
    return this.client.getQueryCache().subscribe(() => listener());
  }
}

export function createWorkspaceQueryClient(state?: DehydratedWorkspaceCache) {
  return new WorkspaceQueryClient(state);
}

export function dehydrate(client: WorkspaceQueryClient) {
  return client.dehydrate();
}

const WorkspaceCacheContext = createContext<WorkspaceQueryClient | null>(null);
const fallbackClient = new WorkspaceQueryClient();

export function WorkspaceCacheProvider({
  children,
  client,
  state,
}: {
  children?: ReactNode;
  client?: WorkspaceQueryClient;
  state?: DehydratedWorkspaceCache;
}) {
  const ref = useRef<WorkspaceQueryClient | null>(null);
  const lastStateRef = useRef<DehydratedWorkspaceCache | undefined>(undefined);
  if (!ref.current) {
    ref.current = client ?? new WorkspaceQueryClient(state);
    lastStateRef.current = state;
  }

  useEffect(() => {
    if (!ref.current) return;
    if (state === lastStateRef.current) return;
    lastStateRef.current = state;
    ref.current.hydrate(state);
  }, [state]);

  return createElement(
    WorkspaceCacheContext.Provider,
    { value: ref.current },
    children,
  );
}

export function HydrationBoundary({
  children,
  state,
}: {
  children?: ReactNode;
  state?: DehydratedWorkspaceCache;
}) {
  return createElement(WorkspaceCacheProvider, { state }, children);
}

export function useWorkspaceCacheQueryClient() {
  return useContext(WorkspaceCacheContext) ?? fallbackClient;
}

export function useWorkspaceCacheQuery<T>(
  queryKey: WorkspaceQueryKey,
): T | undefined {
  const client = useWorkspaceCacheQueryClient();
  return useSyncExternalStore(
    (listener) => client.subscribe(listener),
    () => client.getQueryData<T>(queryKey),
    () => client.getQueryData<T>(queryKey),
  ) as T | undefined;
}

export function logWorkspaceTabSwitchLatency(view: string, workspaceId: string) {
  if (
    typeof window === "undefined" ||
    process.env.NEXT_PUBLIC_SHARED_WORKSPACE_CACHE !== "true"
  ) {
    return;
  }
  const now = performance.now();
  const key = "__workspaceSharedCacheLastMark";
  const previous = (window as unknown as Record<string, number>)[key];
  (window as unknown as Record<string, number>)[key] = now;
  const delta = typeof previous === "number" ? now - previous : 0;
  console.log(
    `[shared-workspace-cache] ${view} workspace=${workspaceId} tabSwitchMs=${delta.toFixed(1)}`,
  );
}
