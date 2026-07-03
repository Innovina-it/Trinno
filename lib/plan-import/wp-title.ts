// Display title for a work package's board card, sub-board, and Drive folder.
// Gemini extracts the WP code ("WP1") and title ("Project Management …") into
// separate fields, so the bare title drops the code. This re-prefixes it as
// "WP1 — Title", matching the manual seeders (e.g. scripts/seeds/arise.mjs).
// Client-safe: build.ts (server-only) imports it, but this module pulls in
// nothing server-only, so it stays unit-testable.

const SEP = " — "; // em dash, matching the manual seeders' card titles

// True when `title` already opens with `code` at a word boundary, so we must
// not prefix again (avoids "WP1 — WP1 — …"). The boundary check stops a code
// like "WP1" from matching the front of an unrelated "WP10".
function titleStartsWithCode(title: string, code: string): boolean {
  if (!title.toLowerCase().startsWith(code.toLowerCase())) return false;
  const next = title.charAt(code.length);
  return next === "" || !/[A-Za-z0-9]/.test(next);
}

// Prepend a non-empty `code` to `title` unless the title already carries it.
// Empty/whitespace code → bare title; empty title → bare code.
export function wpDisplayTitle(code: string, title: string): string {
  const c = (code ?? "").trim();
  const t = (title ?? "").trim();
  if (!c) return t;
  if (!t) return c;
  return titleStartsWithCode(t, c) ? t : `${c}${SEP}${t}`;
}
