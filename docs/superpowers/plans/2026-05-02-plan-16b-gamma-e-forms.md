# Plan #16b-γ-E — Forms & rich content

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. Mid-size slice (5 items, ~6 hrs subagent). Each item is independent enough to commit per task.

**Scope (5 items from queue):**
- **#49** Markdown rendering for card descriptions + comments (with sanitization).
- **#50** `@mention` autocomplete in comments (caret-anchored popover, workspace-profile-backed).
- **#51** Paste image into a comment / description → upload + auto-insert markdown image.
- **#52** Drag-and-drop file from OS onto a comment / description → upload + auto-insert markdown link.
- **#53** Polished date picker primitive replacing 6 native `<input type="date">` call sites.

**Out of scope:**
- Full WYSIWYG editor (e.g. tiptap). We stay with `<textarea>` + markdown render; cheaper, less footgun-prone.
- `#-issue` / `[[wiki-link]]` markdown extensions.
- Slash commands inside the editor.
- Replacing roadmap-bar's mid-drag inline date inputs (they're ephemeral and the calendar primitive isn't worth the dnd interplay).

**Depends on:**
- existing `actions/comments.ts` (has `createComment(cardId, body, mentionedUserIds?)`)
- existing `actions/attachments.ts` (has `registerAttachment` + the signed-upload flow under `/api/upload`)
- existing `useBoardStore.boardProfiles` (per-board profile list, used for mention popover)
- workspace profiles via `useWorkspaceStore.workspaceProfiles` (cross-board comments via aggregate-kanban view)
- `@base-ui/react` (already a dep — `^1.4.1`) — used for popover primitive
- `lucide-react` (already a dep) — icons

**Tech Stack additions:**
- `react-markdown` + `remark-gfm` + `rehype-sanitize` (SSR/CSR safe markdown render).
- `react-day-picker` (calendar primitive — small, headless, easy to style with our mono palette).

These are the only new deps; they're widely-used and stable.

---

## File Structure

**New files:**
- `lib/markdown/render.ts` — pure helper that compiles a markdown string into safe React nodes via `react-markdown` + `remark-gfm` + `rehype-sanitize`. Exports `<MarkdownView source={…} />` (a thin component wrapping the render call).
- `lib/markdown/mentions.ts` — pure helpers `extractMentions(body): { displayName, userId }[]` + `replaceMentionTokens(body)` (used by the comment renderer to swap `@[Name](id)` tokens for highlighted spans + the action layer to map mentioned-user-ids to notifications).
- `tests/unit/markdown-mentions.test.ts` — TDD coverage for the parser.
- `components/ui/mention-popover.tsx` — caret-anchored popover that lists workspace profiles filtered by query. Drives both the `@` typeahead in comments and a future "share with…" picker.
- `components/ui/calendar.tsx` — shadcn-style wrapper around `react-day-picker` styled with our tokens.
- `components/ui/date-picker.tsx` — popover-anchored trigger + `<Calendar />` body. Drop-in replacement for `<input type="date">` (controlled `value: string | null`, `onChange(next: string | null)` with ISO-yyyy-mm-dd strings).
- `tests/unit/date-picker.test.ts` — render + interaction smoke (uses the calendar primitive's exported helpers, no jsdom needed; pure helpers only).
- `tests/e2e/forms.spec.ts` — E2E: markdown render, mention autocomplete + notification, paste image roundtrip, file drop, date picker selection.

**Modified files:**
- `components/board/card/comments-section.tsx` — render comment body via `<MarkdownView />`; wire `<MentionPopover />` to the `<textarea>`; add paste-image + file-drop handlers; thread mentioned-user-ids through `createComment`.
- `components/board/card/description-section.tsx` (or wherever description editor lives) — same treatment minus mention notifications.
- `actions/comments.ts` — accept `mentionedUserIds: string[]`, deduplicate, write rows into `notifications` (kind `comment.mention`). Likely already exists; verify.
- `components/board/card/due-section.tsx` — swap `<input type="date">` for `<DatePicker />`.
- `components/board/card/roadmap-dates-section.tsx` — same swap (two date inputs).
- `components/roadmap/new-card-dialog.tsx` — same swap (two date inputs).
- `components/sprint/create-sprint-dialog.tsx` — same swap.
- `components/roadmap/roadmap-header.tsx` — `roadmap-jump-date` swap (single input).
- `components/roadmap/roadmap-bar.tsx` — `roadmap-bar-dates-start` / `-target` swap. **Skip if it conflicts with the bar overflow menu's existing positioning** (note in self-review).

---

## Decisions (locked)

| Choice | Decision | Why |
|---|---|---|
| Editor type | `<textarea>` + markdown render (no WYSIWYG) | Cheap, predictable, Vim users happy. WYSIWYG out of scope. |
| Markdown engine | `react-markdown@^10` + `remark-gfm` + `rehype-sanitize` | Vetted XSS sanitizer; no `dangerouslySetInnerHTML` directly. |
| Mention syntax | `@[Display Name](user-id-uuid)` | Round-trips cleanly through markdown; the action parses tokens out. Visible-as-text fallback if the renderer skips. |
| Mention popover anchor | base-ui `<Popover>` keyed to caret position via `getCaretCoordinates` (small util — vendor in `lib/textarea-caret.ts`) | Avoid heavy dep like `tribute.js`. |
| Date picker | `react-day-picker@^9` | Headless + mono-friendly. Existing libs (`@base-ui`, `lucide-react`) cover the popover trigger. |
| Date value shape | ISO `yyyy-mm-dd` string (or `null`) | Same shape as the native `<input type="date">` it replaces — drop-in for callers. |

---

## Tasks

### #49 — Markdown rendering — 1.5 hr

**Files:**
- New: `lib/markdown/render.ts`
- Modified: `components/board/card/comments-section.tsx`, description editor.

#### Step 1 — Add deps

```bash
npm install react-markdown remark-gfm rehype-sanitize
```

#### Step 2 — Write the renderer

```tsx
// lib/markdown/render.ts
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";

// Allow our `@[Name](userId)` mention syntax to render as a `<span>` with
// a stable className. Sanitize otherwise — no inline HTML, no <script>.
const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    span: [...(defaultSchema.attributes?.span ?? []), ["data-mention", true], ["data-user-id", true]],
  },
};

export function MarkdownView({ source }: { source: string }) {
  return (
    <div className="prose prose-invert max-w-none text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, schema]]}
        components={{
          // Strip raw <a> targeting other origins; keep simple links.
          a: ({ children, href, ...rest }) => (
            <a
              {...rest}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-fg"
            >
              {children}
            </a>
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
```

#### Step 3 — Wire into comments

In `components/board/card/comments-section.tsx`, replace the plain-text comment body render with `<MarkdownView source={comment.body} />`. Comment input stays a `<textarea>` — users type markdown, see preview on submit.

Add a "Preview" toggle next to the submit button: shows the same `<MarkdownView>` over the typed body before send.

#### Step 4 — Wire into description editor

Same pattern. Description renders as `<MarkdownView />` when not editing; click to edit reveals the textarea.

#### Step 5 — Verify

- `npx tsc --noEmit`
- Visit a card; type `**bold** and a [link](https://example.com)` in a comment; preview shows formatted; submit; rendered correctly.
- XSS smoke: comment body `<script>alert(1)</script>` renders as escaped text, no script execution.

#### Commit

```
feat(forms): #49 markdown rendering for descriptions + comments
```

---

### #50 — Mention autocomplete — 2 hr

**Files:**
- New: `lib/markdown/mentions.ts` (extract + replace tokens)
- New: `tests/unit/markdown-mentions.test.ts` (TDD)
- New: `components/ui/mention-popover.tsx`
- New: `lib/textarea-caret.ts` (vendored caret-coords util)
- Modified: `components/board/card/comments-section.tsx`
- Modified: `actions/comments.ts` (already accepts mentionedUserIds — verify)

#### Step 1 — TDD: extractMentions / replaceMentionTokens

Tests (`tests/unit/markdown-mentions.test.ts`):

```ts
import { describe, it, expect } from "vitest";
import { extractMentions, replaceMentionTokens } from "@/lib/markdown/mentions";

describe("extractMentions", () => {
  it("returns empty for plain text", () => {
    expect(extractMentions("hello world")).toEqual([]);
  });
  it("parses a single mention token", () => {
    expect(extractMentions("hello @[Ada](u-1) world")).toEqual([
      { displayName: "Ada", userId: "u-1" },
    ]);
  });
  it("parses multiple distinct mentions", () => {
    const m = extractMentions("@[Ada](u-1) and @[Bob](u-2)");
    expect(m).toEqual([
      { displayName: "Ada", userId: "u-1" },
      { displayName: "Bob", userId: "u-2" },
    ]);
  });
  it("dedupes repeated user-ids", () => {
    const m = extractMentions("@[Ada](u-1) and again @[Ada](u-1)");
    expect(m).toEqual([{ displayName: "Ada", userId: "u-1" }]);
  });
  it("ignores tokens with non-uuid-shaped ids", () => {
    expect(extractMentions("@[Ada](not-an-id!)")).toEqual([]);
  });
});

describe("replaceMentionTokens", () => {
  it("replaces tokens with display HTML span", () => {
    expect(replaceMentionTokens("hi @[Ada](u-1)!")).toBe(
      'hi <span data-mention data-user-id="u-1">@Ada</span>!',
    );
  });
});
```

#### Step 2 — Implement

```ts
// lib/markdown/mentions.ts
const MENTION_RE = /@\[([^\]]+)\]\(([0-9a-fA-F-]{8,})\)/g;

export function extractMentions(body: string): { displayName: string; userId: string }[] {
  const seen = new Set<string>();
  const out: { displayName: string; userId: string }[] = [];
  for (const m of body.matchAll(MENTION_RE)) {
    const userId = m[2];
    if (seen.has(userId)) continue;
    seen.add(userId);
    out.push({ displayName: m[1], userId });
  }
  return out;
}

export function replaceMentionTokens(body: string): string {
  return body.replace(
    MENTION_RE,
    (_, name, id) =>
      `<span data-mention data-user-id="${id}">@${name}</span>`,
  );
}
```

#### Step 3 — Vendor caret-coords helper

Vendor a small public-domain function (e.g. textarea-caret-position by Jonathan Ong, ~80 lines) into `lib/textarea-caret.ts`. Exposes `getCaretCoordinates(textarea, position): { top: number; left: number; height: number }`.

#### Step 4 — Build `<MentionPopover>`

```tsx
// components/ui/mention-popover.tsx
"use client";
import { useEffect, useMemo, useRef, useState } from "react";

export type MentionCandidate = {
  userId: string;
  displayName: string;
};

export function MentionPopover({
  candidates,
  query,
  anchor,
  onPick,
  onCancel,
}: {
  candidates: MentionCandidate[];
  query: string;
  anchor: { top: number; left: number };
  onPick: (c: MentionCandidate) => void;
  onCancel: () => void;
}) {
  const filtered = useMemo(
    () =>
      candidates
        .filter((c) =>
          c.displayName.toLowerCase().includes(query.toLowerCase()),
        )
        .slice(0, 8),
    [candidates, query],
  );
  const [active, setActive] = useState(0);
  useEffect(() => {
    setActive(0);
  }, [query]);

  // Keyboard handlers exposed via ref so the host textarea can forward keys.
  // The caller wires window keyboard listeners while the popover is open.

  if (filtered.length === 0) return null;
  return (
    <div
      data-testid="mention-popover"
      role="listbox"
      style={{
        position: "absolute",
        top: anchor.top + 24,
        left: anchor.left,
        zIndex: 50,
      }}
      className="w-64 rounded-md border border-hairline bg-[color:var(--surface-strong)] shadow-2xl py-1"
    >
      {filtered.map((c, i) => (
        <button
          key={c.userId}
          role="option"
          aria-selected={i === active}
          data-testid="mention-popover-item"
          data-user-id={c.userId}
          className={`w-full text-left px-3 py-1.5 text-sm hover:bg-fg/10 ${
            i === active ? "bg-fg/15" : ""
          }`}
          onMouseEnter={() => setActive(i)}
          onClick={() => onPick(c)}
        >
          {c.displayName}
        </button>
      ))}
    </div>
  );
}
```

#### Step 5 — Wire into comments textarea

In `comments-section.tsx`:

```tsx
const [mentionState, setMentionState] = useState<{
  query: string;
  anchor: { top: number; left: number };
} | null>(null);

function onChangeBody(e: React.ChangeEvent<HTMLTextAreaElement>) {
  const value = e.target.value;
  setBody(value);
  // Detect the active "@" token: scan back from the caret until we hit
  // whitespace OR a closing `)` (the tail of a previous mention token).
  const caret = e.target.selectionStart ?? value.length;
  const before = value.slice(0, caret);
  const m = /(?:^|\s)@(\w*)$/.exec(before);
  if (m) {
    const coords = getCaretCoordinates(e.target, caret);
    setMentionState({
      query: m[1],
      anchor: { top: coords.top, left: coords.left },
    });
  } else {
    setMentionState(null);
  }
}

function pickMention(c: MentionCandidate) {
  // Replace the active `@…` partial in `body` with `@[Name](id) `.
  const before = body.slice(0, /* caret */).replace(/@(\w*)$/, "");
  const after = body.slice(/* caret */);
  setBody(`${before}@[${c.displayName}](${c.userId}) ${after}`);
  setMentionState(null);
  textareaRef.current?.focus();
}
```

Render `<MentionPopover candidates={boardProfiles.map(...)} ... />` when `mentionState !== null`.

Wire arrow-up / arrow-down / Enter / Escape on the textarea to drive the popover (when open). Reuse popover's exposed callbacks.

#### Step 6 — Action wiring

`actions/comments.ts`'s `createComment` already supports `mentionedUserIds: string[]` (verify against the existing signature). Pass `extractMentions(body).map((m) => m.userId)` from the client. The action writes `notifications` rows for each (kind `comment.mention`).

If the action signature differs, extend it: parse mentions server-side via the same `extractMentions` helper (re-exported from `@/lib/markdown/mentions`).

#### Step 7 — Verify

- `npm run test:unit` (5 new mention tests pass).
- Manual: open card → comment textarea → type `@A` → popover shows; pick → `@[Ada](id) ` inserted; submit → comment renders with `@Ada` highlighted span; Ada's inbox shows the mention notification.

#### Commit

```
feat(forms): #50 @mention autocomplete + notifications
```

---

### #51 — Paste image — 1 hr

**Files:**
- Modified: `components/board/card/comments-section.tsx`, description editor

The existing `/api/upload` endpoint (verified at `app/api/upload/route.ts`) already returns a signed-upload URL + `path`. Reuse its flow.

#### Step 1 — Paste handler

```tsx
async function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
  for (const item of e.clipboardData.items) {
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (!file) continue;
      e.preventDefault();
      const ext = file.type.split("/")[1] ?? "png";
      const filename = `paste-${Date.now()}.${ext}`;
      try {
        const res = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cardId, filename }),
        });
        if (!res.ok) throw new Error(`upload init ${res.status}`);
        const { signedUrl, token, path } = await res.json();
        const supa = createSupabaseBrowser();
        const up = await supa.storage
          .from("card-attachments")
          .uploadToSignedUrl(path, token, file);
        if (up.error) throw up.error;
        // Use the public-ish path (signed-read). The renderer will
        // sign-on-demand via Supabase's getPublicUrl / createSignedUrl
        // depending on bucket policy.
        const url = supa.storage
          .from("card-attachments")
          .getPublicUrl(path).data.publicUrl;
        // Insert markdown image at caret position.
        insertAtCaret(`![${file.name}](${url})\n`);
        toast.success("Image pasted");
      } catch (err) {
        toast.error((err as Error).message);
      }
      return;
    }
  }
}
```

(Adapt to the existing signed-URL shape used by `attachments-section.tsx:32` — the cited code already uses the PUT-to-signed-URL path. Mirror it for consistency.)

`insertAtCaret(text: string)` — small helper that takes the textarea ref + current `body` state, splices the text at `selectionStart`, sets the new body, restores caret position.

#### Step 2 — Verify

- Open a card → comment textarea → screenshot tool / paste image from clipboard → image appears as markdown reference; preview renders the image.
- Manual smoke; no new automated test (clipboard data is awkward in Playwright).

#### Commit

```
feat(forms): #51 paste image into comment / description
```

---

### #52 — File drop — 1 hr

**Files:**
- Modified: `components/board/card/comments-section.tsx`, description editor

#### Step 1 — Drop handlers

```tsx
function onDragOver(e: React.DragEvent<HTMLTextAreaElement>) {
  if (e.dataTransfer.types.includes("Files")) {
    e.preventDefault();
    setDropHover(true);
  }
}
function onDragLeave() {
  setDropHover(false);
}
async function onDrop(e: React.DragEvent<HTMLTextAreaElement>) {
  e.preventDefault();
  setDropHover(false);
  for (const file of e.dataTransfer.files) {
    // …same upload flow as paste handler…
    const isImage = file.type.startsWith("image/");
    const url = await uploadAndGetUrl(file); // shared helper, extracted from #51
    insertAtCaret(
      isImage
        ? `![${file.name}](${url})\n`
        : `[${file.name}](${url})\n`,
    );
  }
}
```

Visual hint: when `dropHover` is true, show a 2px ring around the textarea (`ring-2 ring-fg/50`).

#### Step 2 — Extract upload helper

Pull the upload logic from `attachments-section.tsx` and the paste handler in #51 into `lib/uploads/upload-file.ts`:

```ts
// lib/uploads/upload-file.ts
import { createSupabaseBrowser } from "@/lib/supabase/browser";

export async function uploadFileForCard(
  cardId: string,
  file: File,
): Promise<{ url: string; path: string; sizeBytes: number; mime: string }> {
  const res = await fetch("/api/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cardId, filename: file.name }),
  });
  if (!res.ok) throw new Error(`upload init ${res.status}`);
  const { signedUrl, path } = await res.json();
  const put = await fetch(signedUrl, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type || "application/octet-stream" },
  });
  if (!put.ok) throw new Error(`upload PUT ${put.status}`);
  const supa = createSupabaseBrowser();
  const url = supa.storage.from("card-attachments").getPublicUrl(path)
    .data.publicUrl;
  return {
    url,
    path,
    sizeBytes: file.size,
    mime: file.type || "application/octet-stream",
  };
}
```

Refactor `attachments-section.tsx` to consume this helper. Bonus: dedupes existing duplication between attachments-section and cover-picker.

#### Step 3 — Verify

- Drag a file onto a comment textarea; markdown link appears; preview renders.
- Drag an image onto a description; markdown image appears.

#### Commit

```
feat(forms): #52 drag-drop file upload + shared upload helper
```

---

### #53 — Date picker primitive — 30 min + 1 hr replace

**Files:**
- New: `components/ui/calendar.tsx`, `components/ui/date-picker.tsx`
- New: `tests/unit/date-picker.test.ts` (smoke for the helper conversion)
- Modified: 6 call sites

#### Step 1 — Add dep

```bash
npm install react-day-picker date-fns
```

#### Step 2 — `<Calendar />` shadcn-style wrapper

```tsx
// components/ui/calendar.tsx
"use client";
import { DayPicker, type DayPickerProps } from "react-day-picker";
import "react-day-picker/style.css";

export function Calendar(props: DayPickerProps) {
  return (
    <DayPicker
      showOutsideDays
      className="text-sm text-fg"
      classNames={{
        // … map react-day-picker classes onto our mono palette tokens.
        // (Detail elided here; lift the shadcn-published Calendar component
        // verbatim if available, then replace its `tw-merge` color classes
        // with `text-fg` / `bg-fg/5` / `ring-fg/40` etc.)
      }}
      {...props}
    />
  );
}
```

#### Step 3 — `<DatePicker />` trigger + popover

```tsx
// components/ui/date-picker.tsx
"use client";
import { useState } from "react";
import { Popover, PopoverTrigger, PopoverContent } from "@base-ui/react/popover";
import { CalendarIcon } from "lucide-react";
import { Calendar } from "./calendar";

function fmt(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function DatePicker({
  value,
  onChange,
  placeholder = "Pick a date",
  testId,
  ariaLabel,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  placeholder?: string;
  testId?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        data-testid={testId}
        aria-label={ariaLabel}
        className="chip mono-meta-sm inline-flex items-center gap-1.5 hover:bg-fg/10"
      >
        <CalendarIcon className="size-3" />
        {value ? fmt(value) : placeholder}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner align="start">
          <Popover.Popup className="rounded-md border border-hairline bg-[color:var(--surface-strong)] p-2 shadow-2xl">
            <Calendar
              mode="single"
              selected={value ? new Date(value) : undefined}
              onSelect={(d: Date | undefined) => {
                onChange(d ? d.toISOString().slice(0, 10) : null);
                setOpen(false);
              }}
            />
            {value && (
              <button
                type="button"
                className="mono-meta-sm text-fg-muted hover:text-fg mt-2"
                data-testid="date-picker-clear"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                Clear
              </button>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
```

#### Step 4 — Replace 6 call sites

Each replacement is mechanical:

```diff
- <input
-   type="date"
-   value={start}
-   onChange={(e) => setStart(e.target.value)}
-   data-testid="roadmap-new-card-start"
-   ...
- />
+ <DatePicker
+   value={start || null}
+   onChange={(v) => setStart(v ?? "")}
+   testId="roadmap-new-card-start"
+   placeholder="Start date"
+ />
```

Sites:
1. `components/board/card/due-section.tsx` — due-date input.
2. `components/board/card/roadmap-dates-section.tsx` — start + target.
3. `components/roadmap/new-card-dialog.tsx` — start + target.
4. `components/sprint/create-sprint-dialog.tsx` — start + end.
5. `components/roadmap/roadmap-header.tsx` — `roadmap-jump-date` (the pass-through onChange semantics keep the same).
6. `components/roadmap/roadmap-bar.tsx` — `roadmap-bar-dates-start` + `-target`. **Verify** that the bar overflow-menu's positioning doesn't conflict with the popover (popovers anchored to triggers on a tight chevron menu can clip). If it does, leave the native `<input type="date">` here and document.

#### Step 5 — Verify

- `npx tsc --noEmit`
- `npm run test:unit`
- Visit each modified page; pick + clear a date; values flow correctly.

#### Commit

```
feat(forms): #53 unified DatePicker primitive (replaces 6 native date inputs)
```

---

### E2E spec — 1 hr

**File:** `tests/e2e/forms.spec.ts`

Per-spec coverage (independent seeds, signup-per-spec):

1. **Markdown render** — open a card → comment with `**bold** [link](https://x)` → submit → `<strong>` + `<a>` rendered.
2. **Mention notification** — workspace has user A and user B. A signs in → opens a card → comments `@[B](b-id) hi` (use the pre-seeded user id). B signs in (separate page context) → inbox shows mention.
3. **Date picker** — open a card → click due-date trigger → popover opens → pick today → trigger label shows today; reload → persisted.
4. **Drag-drop file** — `setInputFiles` simulates a drop on the textarea; markdown link appears post-upload.
5. **Paste image** — *skipped* (clipboard data hard to fake reliably). Cover via manual smoke.

#### Commit

```
test(e2e): forms — markdown, mention, date picker, file drop
```

---

## Verification (run before declaring plan complete)

- [ ] `npx tsc --noEmit`
- [ ] `npm run test:unit` (mention parser + date helper tests pass; existing 185 still pass)
- [ ] `npm run lint` — no new warnings
- [ ] Manual smoke matrix:
  - Card description: type markdown → preview → submit → renders.
  - Comment: type markdown + `@user` → popover → submit → notification fires.
  - Paste a screenshot into a comment → uploaded; markdown image inserted.
  - Drop a file onto a comment → uploaded; markdown link inserted.
  - Card due-date picker → pick → save → persisted.
  - Roadmap dates dialog → pick start + target → save → persisted.
  - Sprint create dialog → pick start + end → create → persisted.
  - Roadmap header jump-to-date → pick → scrolls to date.
- [ ] `tests/e2e/forms.spec.ts` — all specs pass.

---

## Self-Review Notes

- **Spec coverage:** all 5 items have dedicated tasks. #51 paste defers automated test, documented.
- **New dependencies:** `react-markdown`, `remark-gfm`, `rehype-sanitize`, `react-day-picker`, `date-fns`. All widely-used; total bundle delta ≈ 60 KB gzipped.
- **Imports verified:** `createComment` already exists at `actions/comments.ts:6`, signed-upload at `app/api/upload/route.ts`. `useBoardStore.boardProfiles` confirmed.
- **XSS:** `rehype-sanitize` with `defaultSchema` strips `<script>`, `<iframe>`, on-event handlers. The mention-token render path uses a controlled `<span>` with two whitelisted attributes (`data-mention`, `data-user-id`).
- **Caret-coords vendoring:** the upstream library is MIT and ~80 lines. We vendor rather than depend to avoid pulling in a `package`-style dep that hasn't been touched in 4+ years.
- **Markdown editor vs WYSIWYG:** stayed with textarea + render. WYSIWYG (e.g. tiptap) would also collide with the mention popover's caret math — mention insertion in tiptap requires a custom node type. Defer to v2 if user asks.
- **Date picker vs native:** native `<input type="date">` keeps keyboard accessibility for free. The DatePicker primitive must add `aria-label` + escape-to-close + arrow-key navigation (react-day-picker handles this) to maintain parity. Verify in γ-F a11y plan.
- **Roadmap bar inline date inputs:** flagged — only replace if the popover doesn't interact badly with the overflow menu's positioning. If skipped, document in concerns.md.

---

## Estimated effort

| Task | Effort |
|---|---|
| #49 — markdown render | 1.5 hr |
| #50 — mention autocomplete | 2 hr |
| #51 — paste image | 1 hr |
| #52 — file drop + extract upload helper | 1 hr |
| #53 — date picker + 6 site swap | 1.5 hr |
| E2E | 1 hr |
| **Total** | **~8 hrs** subagent (~1 day) |

(Slightly higher than the queue's "~6 hrs" estimate because #50 mention popover + #53 6-site swap add up. Real measure by the implementer; budget 8.)
