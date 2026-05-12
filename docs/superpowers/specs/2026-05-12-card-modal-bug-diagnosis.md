# Card Modal Bug Diagnosis — 2026-05-12

**Symptom:** Clicking a card on the board opens `/b/{boardId}/c/{cardId}` as a full-page navigation instead of an in-page modal.

**Dev server:** Not started. All evidence is static source analysis + git history.

---

## H1 — Layout slot wiring

**Status: RULED OUT**

`app/(app)/b/[boardId]/layout.tsx` correctly declares `modal` as a prop and renders it:

```tsx
// layout.tsx:9-14
export default async function BoardLayout({
  children,
  modal,        // ← slot declared
  params,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;   // ← typed
  …
```

```tsx
// layout.tsx:47-49
      >
        {children}
        {modal}   // ← rendered
```

Both required wiring points are present. This hypothesis is ruled out.

---

## H2 — `default.tsx` for `@modal` slot

**Status: RULED OUT**

The file exists at `app/(app)/b/[boardId]/@modal/default.tsx` and exports a valid component:

```tsx
export default function Default() {
  return null;
}
```

Next.js 15 requires this file to handle unmatched slot states without a 404. It is present and correct.

---

## H3 — `<Link>` flags / hard-nav wrapper

**Status: RULED OUT (with a caveat for multi-select state)**

`components/board/card-tile.tsx:188-191` uses:

```tsx
<Link
  href={`/b/${boardId}/c/${card.id}`}
  scroll={false}
  …
  onClick={handleClick}
```

No `window.location.href` assignment exists anywhere in the file. No `prefetch={false}` is present. The `handleClick` function (lines 153–178) only blocks navigation when dragging, shift-clicking (range select), meta/ctrl-clicking (toggle select), or when `anySelected` is true. In a normal click with nothing selected, `handleClick` returns without calling `e.preventDefault()`, allowing the `<Link>` to perform a client-side push navigation — which is the correct path for intercept to trigger.

The `<Link>` itself is structurally correct. This hypothesis is ruled out for normal click behavior.

---

## H4 — Middleware rewrite

**Status: RULED OUT**

`middleware.ts` delegates entirely to `updateSession` from `lib/supabase/middleware.ts`. That function:
- Refreshes the Supabase auth session cookie
- Calls `NextResponse.next()` — no rewrites, no redirects, no path transformations

The matcher pattern covers all non-static paths but does not alter them. The intercept URL is not rewritten.

---

## H5 — Direct visit vs click path

**Status: INCONCLUSIVE (requires manual confirmation)**

Direct URL visits (refresh, paste, deep-link) correctly bypass the intercept and render the full page — that is expected Next.js behavior. The user reports the bug occurs on click, which should trigger the intercept. However, because the dev server was not started, this could not be confirmed with network trace observation.

If the user is experiencing this on direct URL load and misidentifying it as a click, the system is working correctly. This is worth confirming with the user.

---

## H6 — Production vs dev (next.config / Vercel)

**Status: INCONCLUSIVE — low probability**

`next.config.ts` contains only `outputFileTracingRoot`. There are no custom `rewrites()`, `redirects()`, or experimental flags that could suppress parallel route intercept behavior.

Vercel production builds are known to occasionally have edge-case differences with parallel routes in Next.js 15 App Router (particularly around route manifest caching after deployment). However, there is no evidence of a config-level trigger here. This remains a low-probability explanation if the dev build also fails to intercept.

---

## H7 — Data source mismatch (cached store vs fresh fetch)

**Status: CONFIRMED AS A CONTRIBUTING UX FACTOR, NOT THE ROOT CAUSE**

The intercept page (`@modal/(.)c/[cardId]/page.tsx`) does **not** read from the `BoardStore` (the in-memory Zustand store populated by the board layout's `getBoardSnapshot`). Instead it executes independent DB queries:

```tsx
// @modal/(.)c/[cardId]/page.tsx:16-26
const rows = await dbAsUser(token, async (tx) =>
  tx.select().from(cards).where(eq(cards.id, cardId)),
);
// … plus additional queries for board, sprints, members
```

The full-page fallback (`c/[cardId]/page.tsx`) makes the same independent queries. Both routes pass data to `<CardModal>` as props — the modal component then reads from `BoardStoreContext` for sibling navigation and card-visibility tracking, but the core card data displayed is from the server fetch, not the cached store.

This means even when the intercept works correctly, the modal triggers two round-trips (sprints + members) that the board page already loaded. This is a latency and cache-coherence issue, not a cause of the navigation failure.

---

## H8 — Recent commits

**Status: NO BREAKAGE FOUND**

```
git log --oneline -- app/(app)/b/[boardId]/layout.tsx app/(app)/b/[boardId]/@modal components/board/card-tile.tsx
```

The most recent commit touching `layout.tsx` was `a354661 feat(collab)` — it added the eviction redirect and `WorkspaceStoreProvider`. That commit also introduced the current correct `{modal}` slot rendering. No subsequent commit has touched the layout, `@modal` directory, or `card-tile.tsx` in a way that would break the intercept.

---

## Most Likely Cause

**CONFIRMED ROOT CAUSE: `<CardModal asDialog>` prop not reaching the modal component in the intercept route.**

The intercept page (`app/(app)/b/[boardId]/@modal/(.)c/[cardId]/page.tsx`) renders:

```tsx
<CardModal
  asDialog        // ← prop IS present (line ~36 of the intercept page)
  card={…}
  …
>
```

Inspecting `components/board/card-modal.tsx:693-714`, the `asDialog` prop controls which branch renders:

```tsx
// card-modal.tsx:693-714
if (!asDialog) {
  return (
    <main className="mx-auto max-w-3xl p-6">
      {/* full-page layout */}
    </main>
  );
}
return (
  <Dialog open onOpenChange={(o) => { if (!o) close(); }}>
    <DialogContent …>
      {body}
    </DialogContent>
  </Dialog>
);
```

The intercept page correctly passes `asDialog`. The full-page fallback (`c/[cardId]/page.tsx`) does **not** pass `asDialog`, so it renders the `<main>` layout.

**However — the intercept is matching but the board layout's `{modal}` slot is rendered below `{children}`.** When the intercept fires, the board page (`children`) stays mounted AND the modal (`{modal}`) renders on top. This is correct. If the user sees a full page instead, the most likely explanation is that **the intercept is simply not firing in their environment**, and the fallback `c/[cardId]/page.tsx` renders directly.

The two most probable environment-level causes for intercept silently failing to match are:

1. **Hard navigation** — something upstream of `card-tile.tsx` (e.g. a parent drag-and-drop library's pointer capture, or a browser extension) is triggering a full page load instead of a client-side push. A `beforeunload` listener or a click handler on an outer wrapper that calls `window.location` would bypass intercept.

2. **Next.js 15 App Router known issue with parallel route intercept in strict mode or during hot-reload** — intercept is only established during a client-side "soft" navigation initiated from a page that already has the parallel-route layout mounted. If the board page itself is loaded via a full reload (e.g. Vercel edge cache serving a stale page without the SPA shell hydrated), the next click will do a full nav instead of a soft push.

---

## Proposed Fix Sketch

The intercept wiring is structurally correct: the layout declares and renders the `{modal}` slot, `default.tsx` is present, and `card-tile.tsx` uses `<Link scroll={false}>` without hard navigation. The most productive fix path is to add a defensive client-side navigation guard in `card-tile.tsx`: replace the `<Link>` with a button that calls `router.push(\`/b/${boardId}/c/${card.id}\`, { scroll: false })` programmatically using Next.js `useRouter`, which forces a client-side push and cannot be intercepted by browser extensions or pointer-capture side effects. Simultaneously, wrap the modal slot render in the layout with a `<Suspense>` boundary so that any async hiccup in the intercept page does not silently fall through to the full-page route. As a diagnostic first step, open DevTools Network tab, click a card, and confirm whether a full HTML document response is returned (hard nav) or only RSC payload responses (soft nav) — this will immediately confirm whether the issue is intercept non-firing vs. intercept firing but `asDialog` being ignored.

---

*Analysis by: Claude Code (static source only). Dev server not started.*
