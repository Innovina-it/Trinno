"use client";

// Client-only hook for paginated card history. Lives in its own file so
// `components/board/card-modal.tsx` (a client component) does NOT pull
// the server-only postgres driver into the browser bundle via
// `lib/queries/card-history.ts`'s top-level drizzle/dbAsUser imports.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CardHistoryRow } from "./card-history-types";

export type { CardHistoryRow };

const DEFAULT_HISTORY_PAGE_SIZE = 20;

type UseCardHistoryPaginatedResult = {
  rows: CardHistoryRow[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadNextPage: () => void;
  reset: () => void;
};

function reviveHistoryRow(row: CardHistoryRow): CardHistoryRow {
  const at = new Date(row.at as unknown as string);
  if (row.kind === "sprint") {
    return {
      ...row,
      at,
      assignedAt: new Date(row.assignedAt as unknown as string),
      removedAt: row.removedAt
        ? new Date(row.removedAt as unknown as string)
        : null,
    };
  }
  return { ...row, at };
}

export function useCardHistoryPaginated(
  cardId: string,
  pageSize = DEFAULT_HISTORY_PAGE_SIZE,
  enabled = true,
): UseCardHistoryPaginatedResult {
  const safePageSize = Math.max(1, pageSize);
  const [rows, setRows] = useState<CardHistoryRow[]>([]);
  const [nextPage, setNextPage] = useState(0);
  const [pageToFetch, setPageToFetch] = useState<number | null>(
    enabled ? 0 : null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    setRows([]);
    setNextPage(0);
    setError(null);
    setHasMore(true);
    setPageToFetch(enabled ? 0 : null);
  }, [cardId, enabled]);

  useEffect(() => {
    if (pageToFetch === null || !hasMore || loading) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      cardId,
      limit: String(safePageSize + 1),
      offset: String(pageToFetch * safePageSize),
    });

    fetch(`/api/card-history?${params.toString()}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: { rows?: CardHistoryRow[]; nextPage?: number | null }) => {
        if (cancelled) return;
        const rawRows = Array.isArray(data.rows) ? data.rows : [];
        const localStart =
          rawRows.length > safePageSize + 1 ? pageToFetch * safePageSize : 0;
        const pageRows = rawRows
          .slice(localStart, localStart + safePageSize)
          .map(reviveHistoryRow);
        setRows((prev) => {
          const seen = new Set(prev.map((row) => `${row.kind}:${row.id}`));
          const next = [...prev];
          for (const row of pageRows) {
            const key = `${row.kind}:${row.id}`;
            if (!seen.has(key)) next.push(row);
          }
          return next;
        });
        const nextPageVal = data.nextPage ?? null;
        const hasLocalMore =
          rawRows.length > safePageSize + 1
            ? localStart + safePageSize < rawRows.length
            : rawRows.length > safePageSize;
        setHasMore(nextPageVal !== null || hasLocalMore);
        setNextPage(nextPageVal !== null ? nextPageVal : pageToFetch + 1);
        setPageToFetch(null);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setPageToFetch(null);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // `loading` intentionally omitted: it is *written* inside this effect.
    // Listing it would re-trigger the effect on every setLoading(true),
    // and the cleanup of the just-started instance would set
    // `cancelled = true` before `.then()` runs, leaving the panel stuck
    // in a loading state forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId, hasMore, pageToFetch, safePageSize]);

  const loadNextPage = useCallback(() => {
    if (loading || !hasMore) return;
    setPageToFetch(nextPage);
  }, [hasMore, loading, nextPage]);

  const reset = useCallback(() => {
    setRows([]);
    setNextPage(0);
    setError(null);
    setHasMore(true);
    setPageToFetch(enabled ? 0 : null);
  }, [enabled]);

  return useMemo(
    () => ({
      rows,
      loading,
      error,
      hasMore,
      loadNextPage,
      reset,
    }),
    [error, hasMore, loadNextPage, loading, reset, rows],
  );
}
