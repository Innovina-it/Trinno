# Plan #16b-γ-E — Forms & rich content

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. Mid-size slice (5 items, ~6 hrs subagent). Each item is independent enough to commit per task.

**Scope (5 items from queue):**
- **#49** WYSIWYG rich-text editor (tiptap-based) for card descriptions + comments, with markdown round-trip storage.
- **#50** `@mention` autocomplete in the editor (tiptap mention extension, workspace-profile-backed).
- **#51** Paste image into the editor → upload + auto-insert inline image node.
- **#52** Drag-and-drop file from OS onto the editor → upload + auto-insert link / image node.
- **#53** Polished date picker primitive replacing 6 native `<input type="date">` call sites.

**Out of scope:**
- Real-time collaborative editing (tiptap supports `@tiptap/extension-collaboration` + Y.js, but that needs a sync server and is its own slice).
- `#-issue` / `[[wiki-link]]` markdown extensions.
- Slash-command palette inside the editor (`@tiptap/extension-mention` covers `@`, but `/cmd` is a separate UX).
- Replacing roadmap-bar's mid-drag inline date inputs (they're ephemeral and the calendar primitive isn't worth the dnd interplay).

**Depends on:**
- existing `actions/comments.ts` (has `createComment(cardId, body, mentionedUserIds?)`)
- existing `actions/attachments.ts` (has `registerAttachment` + the signed-upload flow under `/api/upload`)
- existing `useBoardStore.boardProfiles` (per-board profile list, used for mention popover)
- workspace profiles via `useWorkspaceStore.workspaceProfiles` (cross-board comments via aggregate-kanban view)
- `@base-ui/react` (already a dep — `^1.4.1`) — used for popover primitive in the date picker
- `lucide-react` (already a dep) — icons

**Tech Stack additions:**
- `@tiptap/react` + `@tiptap/starter-kit` — WYSIWYG editor core (ProseMirror under the hood; React glue).
- `@tiptap/extension-mention` + `@tiptap/suggestion` — caret-anchored mention popover, no manual caret-coords plumbing.
- `@tiptap/extension-link` — auto-link + paste-link handling.
- `@tiptap/extension-image` — inline image nodes for paste / drop.
- `@tiptap/extension-placeholder` — placeholder text in empty editors.
- `tiptap-markdown` — markdown serializer/parser (preserves the existing `cards.description` + `comments.body` text columns; no schema change).
- `tippy.js` — required by `@tiptap/extension-mention` for the suggestion popover positioning. (This is the canonical pairing; ~17 KB gzipped.)
- `react-day-picker` + `date-fns` — calendar primitive (small, headless, easy to style with our mono palette).

These are the only new deps; all widely-used and stable. Bundle delta ≈ 130 KB gzipped (tiptap + ProseMirror is the bulk; tree-shakable so unused extensions don't ship).

---

## File Structure

**New files:**
- `components/ui/rich-editor.tsx` — `<RichEditor>` controlled component wrapping tiptap's `useEditor`. Bundles starter-kit + Mention + Link + Image + Placeholder. Exposes `value`, `onChange(markdown)`, `onMentionsChange(userIds)`, `disabled`, `cardId` (passed to upload helper for paste / drop), `placeholder`, `testId`. Markdown round-trip via `tiptap-markdown`.
- `components/ui/rich-view.tsx` — `<RichView source={markdown} />` — read-only render path. Mounts a tiptap editor in `editable: false` mode so the same Mention / Image / Link nodes render with identical styling. Cheaper than a separate markdown→HTML pipeline because we already pay for tiptap on every page that displays comments.
- `lib/markdown/mentions.ts` — pure helpers `extractMentions(markdown): { displayName, userId }[]` + `replaceMentionTokens(markdown)`. Markdown round-trip stores tokens as `@[Name](user-id)` (compatible with our existing notification flow), so we still need the parser for server-side notification fan-out — but on the client, tiptap's Mention extension owns insertion / deletion / display.
- `tests/unit/markdown-mentions.test.ts` — TDD coverage for the parser.
- `lib/uploads/upload-file.ts` — extracted shared upload helper (currently inlined in `attachments-section.tsx` + `cover-picker.tsx`). Used by tiptap's paste / drop hooks.
- `components/ui/calendar.tsx` — shadcn-style wrapper around `react-day-picker` styled with our tokens.
- `components/ui/date-picker.tsx` — popover-anchored trigger + `<Calendar />` body. Drop-in replacement for `<input type="date">` (controlled `value: string | null`, `onChange(next: string | null)` with ISO-yyyy-mm-dd strings).
- `tests/unit/date-picker.test.ts` — render + interaction smoke (uses the calendar primitive's exported helpers, no jsdom needed; pure helpers only).
- `tests/e2e/forms.spec.ts` — E2E: rich render, mention autocomplete + notification, paste image roundtrip, file drop, date picker selection.

**Modified files:**
- `components/board/card/comments-section.tsx` — replace `<textarea>` with `<RichEditor>`; render comment body via `<RichView />`; thread mention-user-ids through `createComment` from the editor's `onMentionsChange`.
- `components/board/card/description-section.tsx` (or wherever description editor lives) — same treatment minus mention notifications (no need to fan out notifications for description edits in v1).
- `components/board/card/attachments-section.tsx` + `components/board/card/cover-picker.tsx` — refactor to consume `lib/uploads/upload-file.ts` (extraction is part of #51 / #52 tasks; deduplicates existing inline logic).
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
| Editor type | **WYSIWYG** via `@tiptap/react` + `@tiptap/starter-kit` | Live formatting (bold / italic / lists / headings / code) without exposing markdown syntax to users. Keyboard shortcuts come for free (`Cmd+B` etc). |
| Storage format | Markdown (via `tiptap-markdown`) in the existing `cards.description` / `comments.body` text columns | No DB migration; comment bodies remain human-readable in DB tools / git diffs of dumps; falls back gracefully if the editor is ever swapped. |
| Sanitization | `tiptap-markdown` round-trips through ProseMirror's schema, which only accepts whitelisted nodes/marks | No raw HTML injection paths. The render component (`<RichView>`) feeds markdown back through the same schema, dropping anything unrecognized. |
| Mention extension | `@tiptap/extension-mention` + `@tiptap/suggestion` | Built-in caret tracking + popover wiring; no manual `getCaretCoordinates` plumbing. Configure with our workspace-profile candidates and a custom render. |
| Mention syntax (storage) | `@[Display Name](user-id-uuid)` | Markdown serializer encodes Mention nodes to this token shape so the existing `extractMentions` parser server-side still works for notification fan-out. |
| Image / link nodes | `@tiptap/extension-image` + `@tiptap/extension-link` | Native paste / drop / autolink support. Image src points to our Supabase Storage signed-public URL. |
| Toolbar | Hidden by default; `Cmd+K` opens a single inline command line; bubble menu on selection for `B` / `I` / `S` / link | Keep the chrome minimal — matches our mono aesthetic. tiptap's `BubbleMenu` extension is stock. |
| Date picker | `react-day-picker@^9` | Headless + mono-friendly. Existing libs (`@base-ui`, `lucide-react`) cover the popover trigger. |
| Date value shape | ISO `yyyy-mm-dd` string (or `null`) | Same shape as the native `<input type="date">` it replaces — drop-in for callers. |

---

## Tasks

### #49 — WYSIWYG editor (tiptap) — 2.5 hr

**Files:**
- New: `components/ui/rich-editor.tsx`, `components/ui/rich-view.tsx`
- Modified: `components/board/card/comments-section.tsx`, description editor.

#### Step 1 — Add deps

```bash
npm install @tiptap/react @tiptap/pm @tiptap/starter-kit \
  @tiptap/extension-link @tiptap/extension-image \
  @tiptap/extension-placeholder @tiptap/extension-mention \
  @tiptap/suggestion tippy.js tiptap-markdown
```

(`@tiptap/pm` is the ProseMirror peer dep. `tippy.js` is the canonical popover positioning library used by the Mention example.)

#### Step 2 — Build `<RichEditor>`

```tsx
// components/ui/rich-editor.tsx
"use client";
import { useEditor, EditorContent, BubbleMenu } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import { useEffect, useMemo, useRef } from "react";
import { mentionExtension } from "./rich-editor-mention"; // Task #50
import { uploadFileForCard } from "@/lib/uploads/upload-file"; // Task #52

export type RichEditorProps = {
  value: string; // markdown
  onChange: (markdown: string) => void;
  /** Called when the set of mention user-ids in the document changes. */
  onMentionsChange?: (userIds: string[]) => void;
  /** Card id is required so paste / drop can upload to /api/upload. */
  cardId: string;
  placeholder?: string;
  disabled?: boolean;
  testId?: string;
  /** Pass workspace profiles in for mention typeahead. */
  mentionCandidates: { userId: string; displayName: string }[];
};

export function RichEditor({
  value,
  onChange,
  onMentionsChange,
  cardId,
  placeholder = "Write…",
  disabled,
  testId = "rich-editor",
  mentionCandidates,
}: RichEditorProps) {
  // Stable callbacks via refs so editor extension config doesn't re-init.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onMentionsChangeRef = useRef(onMentionsChange);
  onMentionsChangeRef.current = onMentionsChange;
  const candidatesRef = useRef(mentionCandidates);
  candidatesRef.current = mentionCandidates;

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        // Disable headings beyond h3 (mono palette doesn't differentiate).
        heading: { levels: [1, 2, 3] },
      }),
      Link.configure({
        openOnClick: false, // we render via bubble menu / Cmd+click
        autolink: true,
        HTMLAttributes: {
          class: "underline underline-offset-2 hover:text-fg",
          rel: "noopener noreferrer",
          target: "_blank",
        },
      }),
      Image.configure({
        inline: false,
        allowBase64: false, // we always upload through /api/upload
      }),
      Placeholder.configure({ placeholder }),
      Markdown.configure({
        // Round-trip markdown so storage shape matches today's text columns.
        html: false,
        tightLists: true,
        bulletListMarker: "-",
        linkify: true,
        breaks: true,
        transformPastedText: true,
        transformCopiedText: true,
      }),
      mentionExtension({ candidatesRef }),
    ],
    [placeholder],
  );

  const editor = useEditor({
    extensions,
    editable: !disabled,
    content: value, // markdown — tiptap-markdown's `setContent` parses on init
    immediatelyRender: false, // SSR-safe (Next.js 15 App Router)
    onUpdate: ({ editor }) => {
      // tiptap-markdown adds `editor.storage.markdown.getMarkdown()`.
      const md = (
        editor.storage.markdown as { getMarkdown: () => string }
      ).getMarkdown();
      onChangeRef.current(md);
      if (onMentionsChangeRef.current) {
        const ids = new Set<string>();
        editor.state.doc.descendants((node) => {
          if (node.type.name === "mention") {
            const id = node.attrs.id as string | undefined;
            if (id) ids.add(id);
          }
        });
        onMentionsChangeRef.current([...ids]);
      }
    },
    editorProps: {
      attributes: {
        // Tailwind prose for typography; mono-friendly overrides via globals.
        class:
          "prose prose-sm prose-invert max-w-none focus:outline-none min-h-[6rem] py-2",
        "data-testid": testId,
      },
      handlePaste: (view, event) => {
        // #51 — paste image. Walk clipboard, upload, insert image node.
        for (const item of event.clipboardData?.items ?? []) {
          if (item.type.startsWith("image/")) {
            const file = item.getAsFile();
            if (!file) continue;
            event.preventDefault();
            void (async () => {
              try {
                const { url } = await uploadFileForCard(cardId, file);
                view.dispatch(
                  view.state.tr.replaceSelectionWith(
                    view.state.schema.nodes.image.create({
                      src: url,
                      alt: file.name,
                    }),
                  ),
                );
              } catch (err) {
                console.error("paste-image upload failed", err);
              }
            })();
            return true;
          }
        }
        return false;
      },
      handleDrop: (view, event) => {
        // #52 — file drop. Same upload flow.
        const files = event.dataTransfer?.files;
        if (!files || files.length === 0) return false;
        event.preventDefault();
        const pos = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        })?.pos;
        void (async () => {
          for (const file of files) {
            try {
              const { url } = await uploadFileForCard(cardId, file);
              const isImage = file.type.startsWith("image/");
              const node = isImage
                ? view.state.schema.nodes.image.create({
                    src: url,
                    alt: file.name,
                  })
                : view.state.schema.text(file.name, [
                    view.state.schema.marks.link.create({ href: url }),
                  ]);
              const tr =
                pos != null
                  ? view.state.tr.insert(pos, node)
                  : view.state.tr.replaceSelectionWith(node);
              view.dispatch(tr);
            } catch (err) {
              console.error("drop upload failed", err);
            }
          }
        })();
        return true;
      },
    },
  });

  // Reflect external `value` changes (e.g. parent reset on submit).
  useEffect(() => {
    if (!editor) return;
    const current = (
      editor.storage.markdown as { getMarkdown: () => string }
    ).getMarkdown();
    if (current !== value) editor.commands.setContent(value, false);
  }, [editor, value]);

  if (!editor) return null;
  return (
    <div
      data-testid={`${testId}-wrap`}
      className="rounded-md border border-hairline bg-[color:var(--surface)] px-3"
    >
      <BubbleMenu editor={editor} tippyOptions={{ duration: 100 }}>
        <div className="flex items-center gap-1 rounded-md border border-hairline bg-[color:var(--surface-strong)] px-1 py-0.5 shadow-lg">
          {(
            [
              { name: "B", cmd: () => editor.chain().focus().toggleBold().run(), active: editor.isActive("bold") },
              { name: "I", cmd: () => editor.chain().focus().toggleItalic().run(), active: editor.isActive("italic") },
              { name: "S", cmd: () => editor.chain().focus().toggleStrike().run(), active: editor.isActive("strike") },
              { name: "</>", cmd: () => editor.chain().focus().toggleCode().run(), active: editor.isActive("code") },
              {
                name: "Link",
                cmd: () => {
                  const url = window.prompt("URL");
                  if (!url) return;
                  editor.chain().focus().setLink({ href: url }).run();
                },
                active: editor.isActive("link"),
              },
            ] as const
          ).map((b) => (
            <button
              key={b.name}
              type="button"
              data-testid={`rich-bubble-${b.name.toLowerCase()}`}
              onClick={b.cmd}
              className={`mono-meta-sm px-1.5 py-0.5 rounded hover:bg-fg/10 ${
                b.active ? "bg-fg/15 text-fg" : "text-fg-muted"
              }`}
            >
              {b.name}
            </button>
          ))}
        </div>
      </BubbleMenu>
      <EditorContent editor={editor} />
    </div>
  );
}
```

#### Step 3 — Build `<RichView>` (read-only render)

```tsx
// components/ui/rich-view.tsx
"use client";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { Markdown } from "tiptap-markdown";
import Mention from "@tiptap/extension-mention";
import { useEffect, useMemo } from "react";

export function RichView({ source }: { source: string }) {
  const extensions = useMemo(
    () => [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Link.configure({
        openOnClick: true,
        HTMLAttributes: {
          class: "underline underline-offset-2 hover:text-fg",
          rel: "noopener noreferrer",
          target: "_blank",
        },
      }),
      Image.configure({ inline: false, allowBase64: false }),
      Mention.configure({
        HTMLAttributes: {
          "data-mention": "true",
          class: "rounded bg-fg/10 px-1 mono-meta-sm",
        },
      }),
      Markdown.configure({ html: false }),
    ],
    [],
  );
  const editor = useEditor({
    extensions,
    editable: false,
    content: source,
    immediatelyRender: false,
  });
  useEffect(() => {
    if (editor) editor.commands.setContent(source, false);
  }, [editor, source]);
  if (!editor) return null;
  return (
    <div className="prose prose-sm prose-invert max-w-none">
      <EditorContent editor={editor} />
    </div>
  );
}
```

#### Step 4 — Wire into comments

In `components/board/card/comments-section.tsx`:

```tsx
// Replace the existing <textarea> block with:
const [body, setBody] = useState("");
const [mentionedUserIds, setMentionedUserIds] = useState<string[]>([]);
const candidates = useMemo(
  () => boardProfiles.map((p) => ({ userId: p.id, displayName: p.displayName })),
  [boardProfiles],
);

// …
<RichEditor
  value={body}
  onChange={setBody}
  onMentionsChange={setMentionedUserIds}
  cardId={cardId}
  placeholder="Add a comment…"
  testId="comment-editor"
  mentionCandidates={candidates}
/>
<Button
  type="button"
  onClick={() => {
    void createComment({ cardId, body, mentionedUserIds });
    setBody("");
    setMentionedUserIds([]);
  }}
  disabled={!body.trim()}
  data-testid="comment-submit"
>
  Comment
</Button>

// And replace the body render with:
<RichView source={comment.body} />
```

#### Step 5 — Wire into description editor

Same pattern. The description editor is currently click-to-edit → textarea → save. Replace with `<RichEditor>` mounted in-place; an explicit `Save` button writes the markdown via `updateCard({ id, description: body })`.

(No mention notifications for description edits in v1.)

#### Step 6 — Verify

- `npx tsc --noEmit`
- Visit a card; comment with **bold**, *italic*, `Cmd+B` toggle works; bubble menu appears on text selection.
- XSS smoke: paste `<script>alert(1)</script>` — tiptap parses as plain text (script tag isn't in the schema), no execution.
- Reload — markdown round-trips, formatting preserved.

#### Commit

```
feat(forms): #49 WYSIWYG editor (tiptap) for descriptions + comments
```

---

### #50 — Mention autocomplete (tiptap-mention) — 2 hr

**Files:**
- New: `components/ui/rich-editor-mention.tsx` (tiptap Mention extension config + suggestion render)
- New: `lib/markdown/mentions.ts` (server-side parser for notification fan-out — kept because the action layer still needs it)
- New: `tests/unit/markdown-mentions.test.ts` (TDD for the parser)
- Modified: `actions/comments.ts` (verify it accepts `mentionedUserIds` — extend if not)

The visible UI plumbing — caret tracking, suggestion popover, keyboard navigation — is all handled by `@tiptap/extension-mention` + `@tiptap/suggestion` + `tippy.js`. We don't write a custom popover.

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

#### Step 3 — Build the Mention extension config

```tsx
// components/ui/rich-editor-mention.tsx
"use client";
import Mention from "@tiptap/extension-mention";
import { ReactRenderer } from "@tiptap/react";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import type { MutableRefObject } from "react";
import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion";

export type MentionCandidate = { userId: string; displayName: string };

const MentionList = forwardRef<
  { onKeyDown: (e: SuggestionKeyDownProps) => boolean },
  SuggestionProps<MentionCandidate>
>(function MentionList({ items, command }, ref) {
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [items]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === "ArrowUp") {
        setActive((a) => (a - 1 + items.length) % Math.max(1, items.length));
        return true;
      }
      if (event.key === "ArrowDown") {
        setActive((a) => (a + 1) % Math.max(1, items.length));
        return true;
      }
      if (event.key === "Enter") {
        const item = items[active];
        if (item) command({ id: item.userId, label: item.displayName });
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) return null;
  return (
    <div
      data-testid="mention-popover"
      role="listbox"
      className="w-64 rounded-md border border-hairline bg-[color:var(--surface-strong)] shadow-2xl py-1"
    >
      {items.map((c, i) => (
        <button
          key={c.userId}
          type="button"
          role="option"
          aria-selected={i === active}
          data-testid="mention-popover-item"
          data-user-id={c.userId}
          className={`w-full text-left px-3 py-1.5 text-sm hover:bg-fg/10 ${
            i === active ? "bg-fg/15" : ""
          }`}
          onMouseEnter={() => setActive(i)}
          onClick={() => command({ id: c.userId, label: c.displayName })}
        >
          {c.displayName}
        </button>
      ))}
    </div>
  );
});

export function mentionExtension({
  candidatesRef,
}: {
  candidatesRef: MutableRefObject<MentionCandidate[]>;
}) {
  return Mention.configure({
    HTMLAttributes: {
      "data-mention": "true",
      class: "rounded bg-fg/10 px-1 mono-meta-sm",
    },
    // Markdown serialization: tiptap-markdown sees `mention` nodes and we
    // emit the `@[Name](id)` token via the renderText fallback.
    renderText({ node }) {
      return `@[${node.attrs.label}](${node.attrs.id})`;
    },
    suggestion: {
      char: "@",
      items: ({ query }) =>
        candidatesRef.current
          .filter((c) =>
            c.displayName.toLowerCase().includes(query.toLowerCase()),
          )
          .slice(0, 8),
      render: () => {
        let component: ReactRenderer<{ onKeyDown: (e: SuggestionKeyDownProps) => boolean }> | null = null;
        let popup: TippyInstance | null = null;
        return {
          onStart: (props) => {
            component = new ReactRenderer(MentionList, {
              props,
              editor: props.editor,
            });
            popup = tippy("body", {
              getReferenceClientRect: props.clientRect as () => DOMRect,
              appendTo: () => document.body,
              content: component.element,
              showOnCreate: true,
              interactive: true,
              trigger: "manual",
              placement: "bottom-start",
            })[0];
          },
          onUpdate(props) {
            component?.updateProps(props);
            popup?.setProps({ getReferenceClientRect: props.clientRect as () => DOMRect });
          },
          onKeyDown(props) {
            if (props.event.key === "Escape") {
              popup?.hide();
              return true;
            }
            return component?.ref?.onKeyDown(props) ?? false;
          },
          onExit() {
            popup?.destroy();
            component?.destroy();
          },
        };
      },
    },
  });
}
```

This is the canonical pattern from tiptap's docs — we wire it once and the editor handles caret tracking, popover positioning, keyboard navigation, and node insertion.

#### Step 4 — Markdown serialization sanity

`tiptap-markdown` ships with serializer hooks for default nodes. The Mention node isn't default; we emit the `@[Name](id)` token via `renderText` (above). On parse, tiptap-markdown re-reads the markdown — but `@[…](…)` looks like a regular link to its parser, so we need to teach the parser to recognize Mention syntax.

The cleanest fix: serialize Mention as `[@Display Name](mention://user-id)`. Then on parse, a small post-processor walks Link marks whose href starts with `mention://`, converts them back to Mention nodes.

Add a small helper in `components/ui/rich-editor-mention.tsx`:

```ts
// Called by the parent after `setContent` to convert the parsed link marks
// back into Mention nodes. tiptap-markdown does the heavy lifting, we just
// post-process the tree.
export function rehydrateMentions(editor: Editor) {
  const tr = editor.state.tr;
  let modified = false;
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    const linkMark = node.marks.find(
      (m) =>
        m.type.name === "link" &&
        typeof m.attrs.href === "string" &&
        m.attrs.href.startsWith("mention://"),
    );
    if (!linkMark) return;
    const userId = (linkMark.attrs.href as string).slice("mention://".length);
    const display = node.text!.replace(/^@/, "");
    const mentionNode = editor.schema.nodes.mention.create({
      id: userId,
      label: display,
    });
    tr.replaceWith(pos, pos + node.nodeSize, mentionNode);
    modified = true;
  });
  if (modified) editor.view.dispatch(tr);
}
```

And update the `renderText` to emit the bracket-link form:

```ts
renderText({ node }) {
  return `[@${node.attrs.label}](mention://${node.attrs.id})`;
},
```

Call `rehydrateMentions(editor)` in `<RichEditor>`'s mount effect after the initial `setContent`. (Same call from `<RichView>`.)

> If the round-trip turns out fragile in practice (e.g. tiptap-markdown drops the link mark on whitespace boundaries), fall back to storing as `@[Name](userId)` plain-text and let the Mention extension's input rule re-create the node. Document the choice in the commit body.

#### Step 5 — Wire candidates into `<RichEditor>` host

In comments-section.tsx (or description-section.tsx), pass workspace + board profiles:

```tsx
const boardProfiles = useBoardStore((s) => s.boardProfiles);
const candidates = useMemo(
  () => boardProfiles.map((p) => ({ userId: p.id, displayName: p.displayName })),
  [boardProfiles],
);
// …
<RichEditor mentionCandidates={candidates} … />
```

The editor reads `candidatesRef.current` on every keystroke (already wired in Task #49).

#### Step 6 — Action wiring

`actions/comments.ts`'s `createComment` already supports `mentionedUserIds: string[]` (verify against the existing signature). The editor exposes `onMentionsChange` which provides the deduped list of user-ids in the doc — pass that straight in:

```tsx
void createComment({ cardId, body, mentionedUserIds });
```

If the action signature differs, extend it. As a defense-in-depth measure, the action ALSO re-parses the body server-side via `extractMentions(body)` and merges the union — this catches a tampered client that sends an empty list while the body contains tokens.

#### Step 7 — Verify

- `npm run test:unit` (mention parser tests pass).
- Manual: open card → editor → type `@A` → popover shows; arrow keys navigate; Enter selects; `@Ada` rendered as a styled chip in the editor; submit → comment renders with the same chip; Ada's inbox shows the mention notification.

#### Commit

```
feat(forms): #50 @mention autocomplete via tiptap-mention + notifications
```

---

### #51 — Paste image (tiptap `handlePaste`) — 30 min

**Files:**
- Modified (already done in #49 via `editorProps.handlePaste`): `components/ui/rich-editor.tsx`
- New: `lib/uploads/upload-file.ts` (shared upload helper — needed by tiptap's paste hook)

The `handlePaste` editorProp wired in Task #49 walks `event.clipboardData.items`, finds `image/*` entries, uploads via `uploadFileForCard`, and inserts an Image node at the caret. The actual code is already in the #49 listing — this task is just **landing the shared upload helper** so the wired-in code isn't a forward reference.

#### Step 1 — Extract `lib/uploads/upload-file.ts`

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

#### Step 2 — Refactor `attachments-section.tsx` + `cover-picker.tsx`

Both currently inline the same upload logic. Replace each with:

```ts
import { uploadFileForCard } from "@/lib/uploads/upload-file";
// …
const { path, sizeBytes, mime } = await uploadFileForCard(cardId, file);
const row = await registerAttachment({ cardId, storagePath: path, filename: file.name, mime, sizeBytes });
```

Verifies: existing attach-via-button + cover-image-upload still work end-to-end.

#### Step 3 — Verify paste path

- Open card → editor → screenshot tool / clipboard paste of an image → tiptap inserts an Image node; the markdown round-trip stores `![filename](signed-url)`.
- No new automated test (clipboard data is awkward in Playwright; covered by E2E only via mock or skipped).

#### Commit

```
feat(forms): #51 paste image via tiptap handlePaste + shared upload helper
```

---

### #52 — File drop (tiptap `handleDrop`) — 30 min

**Files:**
- Modified (already done in #49 via `editorProps.handleDrop`): `components/ui/rich-editor.tsx`

This task is fully wired by Task #49. Listing it separately for queue tracking + commit cadence.

#### Step 1 — Verify the drop path

- Drag a file from the OS onto the editor → `handleDrop` fires → `uploadFileForCard` → image: insert Image node; non-image: insert text with Link mark.
- Drop position uses `view.posAtCoords` so the inserted node lands where the user dropped, not at the prior caret.
- Multiple files in one drop: each is uploaded sequentially (acceptable for v1; parallel upload is a v2 polish).

#### Step 2 — Visual drop indicator (optional, ≤ 5 min)

tiptap's `EditorContent` accepts `onDragEnter` / `onDragLeave` props. Add a `data-drop-active` attribute:

```tsx
const [dropActive, setDropActive] = useState(false);
// …
<div
  data-drop-active={dropActive ? "true" : undefined}
  onDragEnter={(e) => {
    if (e.dataTransfer.types.includes("Files")) setDropActive(true);
  }}
  onDragLeave={() => setDropActive(false)}
  onDrop={() => setDropActive(false)}
  className="… data-[drop-active=true]:ring-2 data-[drop-active=true]:ring-fg/50"
>
  <EditorContent editor={editor} />
</div>
```

#### Commit

```
feat(forms): #52 drop file (image / link) via tiptap handleDrop
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

- **Spec coverage:** all 5 items have dedicated tasks. #51 paste defers automated test (clipboard data is hard to fake in Playwright); documented.
- **New dependencies:** `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/extension-link`, `@tiptap/extension-image`, `@tiptap/extension-placeholder`, `@tiptap/extension-mention`, `@tiptap/suggestion`, `tippy.js`, `tiptap-markdown`, `react-day-picker`, `date-fns`. All widely-used; total bundle delta ≈ 130 KB gzipped (tiptap + ProseMirror is the bulk; tree-shakable).
- **Imports verified:** `createComment` already exists at `actions/comments.ts:6`, signed-upload at `app/api/upload/route.ts`. `useBoardStore.boardProfiles` confirmed. tiptap's `BubbleMenu` + `Mention` + `Image` are the canonical extension exports.
- **XSS:** tiptap parses input through ProseMirror's schema, which only accepts whitelisted nodes / marks. Raw HTML / `<script>` simply doesn't have a target type and is dropped. `<RichView>` uses the same schema in `editable: false` mode — same defenses. Image src URLs go through Supabase Storage; no user-supplied `data:` / `javascript:` URIs are emitted by the editor (image node config disables `allowBase64`).
- **WYSIWYG choice (locked):** tiptap over react-markdown + textarea. Live formatting is the user-facing improvement (Cmd+B works, bubble menu on selection); markdown round-trip via `tiptap-markdown` keeps the storage shape unchanged so no DB migration is needed. The trade-off is bundle size (≈ 130 KB vs ≈ 60 KB) and one round-trip helper for Mention nodes (`rehydrateMentions`); both are acceptable.
- **Mention node ↔ markdown round-trip:** Mention serializes to `[@Display Name](mention://userId)`, parses as a Link mark, and `rehydrateMentions` walks the tree on init/update to recreate Mention nodes. Tested by the unit suite via the parser helpers (the editor itself isn't unit-testable without jsdom, so the round-trip is exercised at E2E only).
- **Date picker vs native:** native `<input type="date">` keeps keyboard accessibility for free. The DatePicker primitive must add `aria-label` + escape-to-close + arrow-key navigation (react-day-picker handles this) to maintain parity. Verify in γ-F a11y plan.
- **Roadmap bar inline date inputs:** flagged — only replace if the popover doesn't interact badly with the overflow menu's positioning. If skipped, document in concerns.md.
- **SSR safety:** `useEditor` is configured with `immediatelyRender: false` (Next.js 15 App Router requirement; otherwise hydration mismatches because tiptap can't deterministically render the same content server-side without DOM).

---

## Estimated effort

| Task | Effort |
|---|---|
| #49 — WYSIWYG editor (tiptap + bubble menu + read-only view) | 2.5 hr |
| #50 — mention extension (config + popover render + markdown round-trip) | 2 hr |
| #51 — paste image (extract shared upload helper + refactor existing inline call sites) | 30 min |
| #52 — file drop (already wired in #49; adds optional drop indicator) | 30 min |
| #53 — date picker + 6 site swap | 1.5 hr |
| E2E | 1 hr |
| **Total** | **~8 hrs** subagent (~1 day) |

(Same total as the textarea-based plan, redistributed: #49 grows because tiptap setup is heavier, but #51/#52 shrink because tiptap's `handlePaste` / `handleDrop` editorProps cover the work that was previously a custom textarea handler. The queue's "~6 hr" estimate is unchanged in spirit; budget 8 to be safe.)
