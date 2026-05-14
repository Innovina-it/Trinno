"use client";

import {
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { useParams } from "next/navigation";
import { useWorkspaceSnapshot } from "@/lib/queries/workspace-snapshot-shared";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { WorkspaceStoreContext } from "@/stores/workspace-store";
import type { FlagName } from "./index";

type RemoteFlagValue = {
  workspaceId: string;
  flag: FlagName;
  value: boolean;
};

const EMPTY_WORKSPACE_ID = "__missing_workspace__";

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function readFlagValue(flags: unknown, flag: FlagName): boolean | undefined {
  if (!flags || typeof flags !== "object" || Array.isArray(flags)) {
    return undefined;
  }

  const record = flags as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(record, flag)) return undefined;

  const value = record[flag];
  return typeof value === "boolean" ? value : undefined;
}

function useWorkspaceIdFromStore(): string | undefined {
  const store = useContext(WorkspaceStoreContext);
  return useSyncExternalStore(
    store ? store.subscribe : () => () => undefined,
    () => store?.getState().workspaceId,
    () => store?.getState().workspaceId,
  );
}

export function useWorkspaceFlag(
  flag: FlagName,
  fallback = false,
): boolean {
  const params = useParams<{ workspaceId?: string | string[] }>();
  const workspaceIdFromStore = useWorkspaceIdFromStore();
  const workspaceId = firstParam(params?.workspaceId) ?? workspaceIdFromStore;
  const snapshot = useWorkspaceSnapshot(workspaceId ?? EMPTY_WORKSPACE_ID);
  const cachedValue = readFlagValue(snapshot?.featureFlags, flag);
  const [remoteValue, setRemoteValue] = useState<RemoteFlagValue | null>(null);

  useEffect(() => {
    if (!workspaceId || cachedValue !== undefined) return;

    let cancelled = false;
    const supabase = createSupabaseBrowser();

    void (async () => {
      try {
        const { data, error } = await supabase
          .from("workspaces")
          .select("feature_flags")
          .eq("id", workspaceId)
          .maybeSingle();
        if (cancelled || error || !data) return;
        const value = readFlagValue(
          (data as { feature_flags?: unknown }).feature_flags,
          flag,
        );
        if (value === undefined) return;
        setRemoteValue({ workspaceId, flag, value });
      } catch {
        /* fall back */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cachedValue, flag, workspaceId]);

  if (cachedValue !== undefined) return cachedValue;
  const matchedRemoteValue = remoteValue;
  if (
    matchedRemoteValue &&
    matchedRemoteValue.workspaceId === workspaceId &&
    matchedRemoteValue.flag === flag
  ) {
    return matchedRemoteValue.value;
  }
  return fallback;
}
