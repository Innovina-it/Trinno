"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { search } from "@/actions/search";

type Result = {
  id: string;
  title: string;
  boardId: string;
  boardTitle: string;
};

export function SearchBox() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        setResults(await search(q));
      } catch {
        setResults([]);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  // Global `/` to focus, when not already typing in another field.
  useEffect(() => {
    function isTyping(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      const tag = target.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    }
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== "/") return;
      if (isTyping(e.target)) return;
      e.preventDefault();
      inputRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const showResults = open && q.trim().length > 0;

  return (
    <div className="relative">
      <Search
        aria-hidden
        className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-faint"
      />
      <input
        ref={inputRef}
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search cards"
        aria-label="Search cards"
        data-testid="search-box"
        className="h-8 w-56 rounded-md border border-hairline bg-[color:var(--surface)] pl-8 pr-9 text-xs text-fg placeholder:text-fg-faint outline-none transition-colors hover:border-hairline-hi focus-visible:border-[color:var(--accent-cyan)]/60 focus-visible:bg-[color:var(--surface-strong)]"
      />
      <kbd
        aria-hidden
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 mono-meta-sm text-fg-faint border border-hairline rounded px-1 py-0 leading-none tabular-nums"
      >
        /
      </kbd>
      {showResults && (
        <div
          className="absolute right-0 top-full mt-1 w-80 max-h-80 overflow-y-auto bg-[color:var(--popover)] border border-[color:var(--hairline-hi)] rounded-xl text-fg z-50 shadow-xl animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-200"
          data-testid="search-results"
        >
          <div className="border-b border-hairline px-3 py-2 flex items-baseline justify-between">
            <span className="mono-meta-sm text-fg-muted">
              {results.length} match{results.length === 1 ? "" : "es"}
            </span>
          </div>
          {results.length === 0 ? (
            <div className="px-3 py-6 text-center space-y-1">
              <p className="mono-meta-sm text-fg-faint">NO RESULTS</p>
              <p className="text-sm text-fg-muted">
                No matches for &ldquo;{q}&rdquo;.
              </p>
            </div>
          ) : (
            <ul className="p-1">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    onMouseDown={(e) => {
                      e.preventDefault();
                      router.push(`/b/${r.boardId}/c/${r.id}`);
                      setOpen(false);
                      setQ("");
                    }}
                    className="block w-full text-left px-3 py-2 rounded-md transition-colors hover:bg-[color:var(--surface-hi)]"
                    data-testid={`search-result-${r.id}`}
                  >
                    <div className="text-sm font-medium leading-tight text-fg">
                      {r.title}
                    </div>
                    <div className="mono-meta-sm mt-1 text-fg-faint">
                      {r.boardTitle}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
