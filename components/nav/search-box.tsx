"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { search } from "@/actions/search";

type Result = { id: string; title: string; boardId: string; boardTitle: string };

export function SearchBox() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      try { setResults(await search(q)); }
      catch { setResults([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const showResults = open && q.trim().length > 0;

  return (
    <div className="relative">
      <Search
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-fg-faint"
      />
      <Input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search cards…"
        className="h-8 w-56 pl-9 pr-3 rounded-full text-xs"
        data-testid="search-box"
      />
      {showResults && (
        <div
          className="absolute right-0 top-11 w-80 max-h-80 overflow-y-auto glass-strong rounded-2xl text-fg z-50 animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-200"
          data-testid="search-results"
        >
          <div className="border-b border-hairline px-4 py-2.5 flex items-baseline justify-between">
            <span className="mono-meta-sm text-fg-muted">
              {results.length} match{results.length === 1 ? "" : "es"}
            </span>
            {results.length > 0 && (
              <span className="block h-px w-12 bg-gradient-to-r from-accent-cyan to-accent-magenta" />
            )}
          </div>
          {results.length === 0 ? (
            <div className="px-3 py-8 text-center">
              <p className="serif-display text-xl text-fg-muted italic">
                Nothing on file.
              </p>
              <p className="mono-meta-sm mt-2 text-fg-faint">
                No matches for &ldquo;{q}&rdquo;
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
                      setOpen(false); setQ("");
                    }}
                    className="block w-full text-left px-3 py-2.5 rounded-xl transition-all duration-150 hover:bg-[color:var(--surface-hi)] hover:translate-x-0.5 group/result"
                    data-testid={`search-result-${r.id}`}
                  >
                    <div className="text-sm font-medium leading-tight text-fg group-hover/result:gradient-text-static">
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
