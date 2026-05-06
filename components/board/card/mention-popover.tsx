"use client";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { searchMentionables } from "@/actions/profile-search";

type Match = { id: string; handle: string; displayName: string };

export type MentionPopoverHandle = {
  // Returns true if the keystroke was consumed (popover handled
  // arrow / enter / escape).  The host textarea's onKeyDown should
  // bail when this returns true so the typed character isn't
  // duplicated.
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean;
};

/**
 * Minimal @-mention popover.  Watches the textarea's `value` + cursor
 * position; when the cursor sits inside an `@<word>` token, it queries
 * `searchMentionables(boardId, prefix)` and shows up to 8 matches.
 * Pressing Enter or clicking a row replaces the active token with
 * `@<handle> ` and calls `onChange(next, nextCaret)` so the host
 * controls textarea state.
 */
export const MentionPopover = forwardRef<
  MentionPopoverHandle,
  {
    boardId: string;
    value: string;
    caret: number;
    onChange: (next: string, nextCaret: number) => void;
  }
>(function MentionPopoverInner({ boardId, value, caret, onChange }, ref) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const tokenRef = useRef<{ start: number; end: number; prefix: string } | null>(
    null,
  );

  // Detect the @-token anchored at the caret.
  useEffect(() => {
    const left = value.slice(0, caret);
    const m = left.match(/(^|\s)@([A-Za-z0-9_.\-]{0,40})$/);
    if (!m) {
      setOpen(false);
      tokenRef.current = null;
      return;
    }
    const start = caret - m[2].length - 1; // include the @
    tokenRef.current = { start, end: caret, prefix: m[2] };
    setOpen(true);
  }, [value, caret]);

  // Debounced search.
  useEffect(() => {
    if (!open || !tokenRef.current) return;
    const prefix = tokenRef.current.prefix;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await searchMentionables(boardId, prefix);
        if (cancelled) return;
        setMatches(r);
        setActive(0);
      } catch {
        if (!cancelled) setMatches([]);
      }
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, boardId, value, caret]);

  function pick(match: Match) {
    const tk = tokenRef.current;
    if (!tk) return;
    const before = value.slice(0, tk.start);
    const after = value.slice(tk.end);
    const ins = `@${match.handle} `;
    const next = `${before}${ins}${after}`;
    const nextCaret = (before + ins).length;
    onChange(next, nextCaret);
    setOpen(false);
  }

  useImperativeHandle(
    ref,
    () => ({
      onKeyDown(e) {
        if (!open || matches.length === 0) return false;
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActive((a) => (a + 1) % matches.length);
          return true;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setActive((a) => (a - 1 + matches.length) % matches.length);
          return true;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          pick(matches[active]);
          return true;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setOpen(false);
          return true;
        }
        return false;
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, matches, active],
  );

  if (!open || matches.length === 0) return null;

  return (
    <div
      role="listbox"
      aria-label="Mention"
      className="absolute left-0 bottom-full mb-1 z-40 w-64 rounded-xl border border-hairline-hi bg-[color:var(--popover)] p-1 shadow-[0_24px_60px_-16px_rgba(0,0,0,0.7)] outline-none"
    >
      {matches.map((m, i) => (
        <button
          key={m.id}
          type="button"
          role="option"
          aria-selected={i === active}
          onMouseDown={(e) => {
            e.preventDefault();
            pick(m);
          }}
          onMouseEnter={() => setActive(i)}
          className={
            "w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors " +
            (i === active
              ? "bg-[color:var(--surface-hi)] text-fg"
              : "text-fg-muted hover:text-fg hover:bg-[color:var(--surface-strong)]")
          }
        >
          <span className="flex-1 min-w-0 truncate">{m.displayName}</span>
          <span className="mono-meta-sm text-fg-faint shrink-0">@{m.handle}</span>
        </button>
      ))}
    </div>
  );
});
