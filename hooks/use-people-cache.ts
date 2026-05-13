"use client";
import { useEffect, useState } from "react";
import { listCollaborators } from "@/actions/profile-search";

// localStorage-backed cache of the caller's collaborator list. Survives
// page reloads, scoped by viewerId so switching accounts on the same
// browser doesn't leak. The cache returns hydrated state synchronously
// from localStorage (instant render path), then revalidates against the
// server in the background once per hook-mount.

type Person = { id: string; handle: string | null; displayName: string };

const KEY_PREFIX = "tr.people.collab.v1.";
// 24h is fine for collaboration lists — they change on the order of weeks.
// The hook always revalidates in the background regardless of TTL; TTL is
// just the cap before we treat the cached value as too stale to display.
const TTL_MS = 24 * 60 * 60 * 1000;

type CacheRecord = {
  people: Person[];
  fetchedAt: number;
};

function keyFor(viewerId: string): string {
  return `${KEY_PREFIX}${viewerId}`;
}

function readCache(viewerId: string | null): CacheRecord | null {
  if (!viewerId || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(keyFor(viewerId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheRecord;
    if (!Array.isArray(parsed?.people)) return null;
    if (Date.now() - parsed.fetchedAt > TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(viewerId: string, people: Person[]) {
  if (typeof window === "undefined") return;
  try {
    const rec: CacheRecord = { people, fetchedAt: Date.now() };
    window.localStorage.setItem(keyFor(viewerId), JSON.stringify(rec));
  } catch {
    /* localStorage full / blocked — silent fallback to network */
  }
}

export function usePeopleCache(viewerId: string | null): {
  people: Person[];
  hydrated: boolean;
  refresh: () => void;
} {
  const [people, setPeople] = useState<Person[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage on first paint when viewerId is known.
  useEffect(() => {
    if (!viewerId) return;
    const cached = readCache(viewerId);
    if (cached) setPeople(cached.people);
    setHydrated(true);
  }, [viewerId]);

  // Background revalidation — once per (viewerId, mount). The server call
  // is cheap (single SQL union + profile fetch), and stale cache renders
  // instantly while this resolves.
  useEffect(() => {
    if (!viewerId) return;
    let cancelled = false;
    listCollaborators()
      .then((fresh) => {
        if (cancelled) return;
        setPeople(fresh);
        writeCache(viewerId, fresh);
      })
      .catch(() => {
        /* keep cached/empty state */
      });
    return () => {
      cancelled = true;
    };
  }, [viewerId]);

  return {
    people,
    hydrated,
    refresh: () => {
      if (!viewerId) return;
      listCollaborators()
        .then((fresh) => {
          setPeople(fresh);
          writeCache(viewerId, fresh);
        })
        .catch(() => {});
    },
  };
}
