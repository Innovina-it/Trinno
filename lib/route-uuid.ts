import { notFound } from "next/navigation";

// RFC 4122 UUID shape. Used to short-circuit malformed URL params before
// they reach Postgres as bind values — without this, Drizzle/postgres
// sends the bad string and PG raises SQLSTATE 22P02 (`invalid input
// syntax for type uuid`), which surfaces as a 500 instead of the
// expected 404 not-found page.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates a path-segment UUID and triggers Next.js `notFound()` if it's
 * malformed. Use in page/layout server components that take a UUID via
 * `params`:
 *
 *   const { boardId } = await params;
 *   assertUuidOrNotFound(boardId);
 *   const snap = await getBoardSnapshot(token, boardId);
 *
 * `notFound()` throws a special signal Next.js catches to render the
 * route's 404, so callers don't need to handle the return value.
 */
export function assertUuidOrNotFound(value: string): void {
  if (!UUID_RE.test(value)) notFound();
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
