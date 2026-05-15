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

// TanStack Query is not installed in this branch. This adapter keeps the
// workspace cache surface intentionally close to the TanStack calls this
// feature needs (`fetchQuery`, hydration, and `invalidateQueries`) so the
// flag-on path can be tested now and replaced with the real package later.
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

type QueryRecord<T = unknown> = WorkspaceCacheEntry<T> & {
  stale: boolean;
  queryFn?: QueryFn<T>;
};

function hashKey(queryKey: WorkspaceQueryKey): string {
  return JSON.stringify(queryKey);
}

function keyStartsWith(key: WorkspaceQueryKey, prefix: WorkspaceQueryKey) {
  if (prefix.length > key.length) return false;
  return prefix.every((part, idx) => Object.is(part, key[idx]));
}

export class WorkspaceQueryClient {
  private records = new Map<string, QueryRecord>();
  private listeners = new Set<() => void>();

  constructor(state?: DehydratedWorkspaceCache) {
    this.hydrate(state);
  }

  hydrate(state?: DehydratedWorkspaceCache) {
    if (!state) return;
    for (const entry of state.queries) {
      this.records.set(hashKey(entry.queryKey), {
        ...entry,
        stale: false,
      });
    }
    this.notify();
  }

  dehydrate(): DehydratedWorkspaceCache {
    return {
      queries: [...this.records.values()].map(({ queryKey, data, updatedAt }) => ({
        queryKey,
        data,
        updatedAt,
      })),
    };
  }

  getQueryData<T>(queryKey: WorkspaceQueryKey): T | undefined {
    return this.records.get(hashKey(queryKey))?.data as T | undefined;
  }

  setQueryData<T>(
    queryKey: WorkspaceQueryKey,
    updater: T | ((current: T | undefined) => T),
  ): T {
    const key = hashKey(queryKey);
    const current = this.records.get(key) as QueryRecord<T> | undefined;
    const data =
      typeof updater === "function"
        ? (updater as (current: T | undefined) => T)(current?.data)
        : updater;
    this.records.set(key, {
      queryKey,
      data,
      updatedAt: Date.now(),
      stale: false,
      queryFn: current?.queryFn,
    });
    this.notify();
    return data;
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
    const key = hashKey(queryKey);
    const current = this.records.get(key) as QueryRecord<T> | undefined;
    if (current && !current.stale && !force) {
      current.queryFn = queryFn;
      return current.data;
    }
    const data = await queryFn();
    this.records.set(key, {
      queryKey,
      data,
      updatedAt: Date.now(),
      stale: false,
      queryFn,
    });
    this.notify();
    return data;
  }

  async invalidateQueries({
    queryKey,
  }: {
    queryKey: WorkspaceQueryKey;
  }): Promise<void> {
    const refetches: Array<Promise<unknown>> = [];
    for (const [key, record] of this.records) {
      if (!keyStartsWith(record.queryKey, queryKey)) continue;
      record.stale = true;
      this.records.set(key, record);
      if (record.queryFn) {
        refetches.push(
          this.fetchQuery({
            queryKey: record.queryKey,
            queryFn: record.queryFn,
            force: true,
          }),
        );
      }
    }
    if (refetches.length === 0) this.notify();
    await Promise.all(refetches);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const listener of this.listeners) listener();
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
