/**
 * Plan #16b-γ-D (#5) — Palette filter helper.
 *
 * Substring + position scoring for the command palette. Lower index =
 * better score (the match starts earlier in the label). Returns null
 * when there's no match so callers can drop the row.
 *
 * This is intentionally simple — no fuse.js, no Levenshtein. The plan
 * notes that anything fancier requires a dep we don't want to ship.
 */
export function paletteScore(label: string, query: string): number | null {
  if (!query) return 0;
  const idx = label.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return null;
  return idx;
}

/**
 * Filter + sort a list of items by `paletteScore` against `query`.
 * Stable when scores tie (preserves declared order, which lets sections
 * render in their intended sequence).
 */
export function filterPalette<T extends { label: string }>(
  items: T[],
  query: string,
): T[] {
  const trimmed = query.trim();
  if (!trimmed) return items;
  const scored = items
    .map((it, i) => ({ it, i, score: paletteScore(it.label, trimmed) }))
    .filter((x): x is { it: T; i: number; score: number } => x.score !== null);
  scored.sort((a, b) => (a.score - b.score) || (a.i - b.i));
  return scored.map((x) => x.it);
}
