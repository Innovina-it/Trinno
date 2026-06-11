/**
 * Maps `items` through `fn` with at most `limit` calls in flight at once.
 * Results keep input order. A rejection propagates to the caller (same
 * contract as Promise.all), so failure behavior matches a plain map.
 *
 * Exists for fan-out over `dbAsUser` work: each call holds a pooled DB
 * connection for its whole transaction, so an unbounded Promise.all over
 * N workspaces can drain the pool and starve every other request on the
 * same instance (the 2026-06-11 prod 504s). Cap the fan-out instead.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i], i);
      }
    },
  );
  await Promise.all(workers);
  return results;
}
