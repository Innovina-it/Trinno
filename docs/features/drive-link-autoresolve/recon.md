# Recon — Drive link auto-resolve

Feature slug: `drive-link-autoresolve`
Tier: 3 (external API + secrets + DB migration)
Status: Gate 0 — recon frozen, awaiting scope approval
Date: 2026-06-04

## Task as given

Make deliverable links automatic: a card/subtask labelled with a code like "D.1.1"
should resolve to its matching Google Drive file/folder via the Drive API and open
on click — instead of a human pasting a Drive URL by hand. Approved direction from
fast-mode triage: **service account + resolve-and-cache into the existing `links`
table + a new structured `code` field on cards.**

## What already exists in repo

- **No Google/Drive integration of any kind** — verified across `package.json` (no
  `googleapis`/`google-auth-library`), all `.env*` files (no `GOOGLE_*`), and source.
  Greenfield. No prior attempt in git log; only branches are `main` and `preview`.
- **Links today** = one manual URL per card. Single `links` table
  (`lib/db/schema.ts:298-308`): `scope` enum `'workspace'|'card'`, `cardId`, `url`,
  `color`, `createdBy`, `updatedAt`. Card links are unique per card
  (`onConflictDoUpdate` on `links.cardId` where `scope='card'`, `actions/links.ts:55`).
  → **Resolve-and-cache writes the resolved Drive URL into this exact row.** `updatedAt`
  already exists → free staleness signal.
- **Open behavior** = `window.open(url)` with defensive scheme prepend
  (`components/links/link-icon.tsx:8-15`). Rendered as a diamond in card quick-view
  (`card-quick-view.tsx:785`).
- **Subtasks are just cards** (`type:"subtask"` + `parentCardId`,
  `subtasks-section.tsx:60`) → inherit link behavior automatically. No separate work.
- **No structured identifier on cards.** `cards` table (`lib/db/schema.ts:149-183`)
  has no `code`/`key`/`wbs` column. "D.1.1" lives only inside free-text `title`.
  → A reliable code field (migration `0123`) is a prerequisite for non-fuzzy matching.
- **Server-side secret + RLS-bypass patterns already exist:**
  - `lib/supabase/service-role.ts` → `getServiceSupabase()` (used by
    `lib/notify-email.ts`, `lib/invite-email.ts`). Precedent for a batch sync that
    writes across many cards without a user token.
  - User-scoped writes go through `dbAsUser(token)` with `assertWorkspaceWriter`
    guards (`actions/links.ts:33-60`) — RLS enforced per user.
- **Vercel Cron already in use:** `vercel.json` crons → `/api/cron/send-emails`
  daily. → Precedent for a scheduled `/api/cron/drive-sync` resolver.
- DB stack: Drizzle ORM + Supabase Postgres, sequential SQL migrations in
  `supabase/migrations/`; latest `0122_roadmap_baselines.sql`; **next = `0123`**.

## Discrepancies between task brief and repo reality

- Brief assumes a label "D.1.1" can be matched → **reality: no code field exists**;
  title-substring matching is ambiguous (two cards can share "D.1.1", titles get
  edited). Decision needed: add `cards.code` column vs enforce title-prefix parsing.
- "Resolve-and-cache" has two viable write paths, each with different blast radius:
  1. **cache-on-first-click** — reuses existing user RLS path (`upsertCardLinkImpl`);
     no new privileged code; resolves lazily per card.
  2. **scheduled batch sync** — `getServiceSupabase()` + Vercel cron; instant clicks
     but introduces RLS-bypassing writes across workspaces. Heavier.
- Drive auth (service account) is **Google-side, independent of Supabase identity**:
  user clicks → server action authenticates the Supabase user → Drive call runs as
  the service account → caches URL. Clean, but the service account only sees files in
  Drives/folders explicitly shared with its email (or domain-wide delegation in
  Google Workspace).

## Overlap with prior work

- None in code. Existing `links` infrastructure (table, actions, store hydration,
  `LinkIcon`) is directly reusable — this is an additive layer, not a rewrite.

## Scope recommendation

- **proceed as-stated (additive):** new `cards.code` column (migration 0123), a
  server-side Drive resolver using a service account, caching resolved URL into the
  existing `links` row.
- **shrink candidate:** ship the resolver as **cache-on-first-click only** (reuse
  user RLS path) and defer the scheduled cron sync to a later epic — removes the
  RLS-bypass surface from v1.
- **clarify with stakeholder before spec (blocking):** the 4 open questions below.
  These change the auth model and matching strategy, so they gate the spec.

## Open questions for user (gate the Spec)

1. **Where do deliverables live?** One shared/Team Drive (→ service account works
   cleanly) or scattered across individuals' personal Drives (→ would force per-user
   OAuth instead, different feature)?
2. **Google Workspace org or plain Gmail accounts?** Workspace enables domain-wide
   delegation; plain Gmail limits the service account to explicitly-shared folders.
3. **Matching key:** add a structured `cards.code` field (recommended, exact match),
   or parse a code prefix out of the title (no migration, but fuzzy)?
4. **Resolve timing:** cache-on-first-click only (smaller blast radius, recommended
   for v1) or also a scheduled cron batch sync (instant but adds privileged writes)?
   And on multiple Drive matches — open first, or show a chooser?

## Human-only prerequisites (cannot be done by the agent)

- Enable Drive API in a Google Cloud project.
- Create a service account + JSON key; store as an env secret.
- Share the deliverables Drive/folder with the service account email (or configure
  domain-wide delegation).
