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
        className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search cards…"
        className="h-8 w-56 pl-8 text-sm"
        data-testid="search-box"
      />
      {showResults && (
        <div
          className="absolute right-0 top-10 w-80 max-h-80 overflow-y-auto rounded-lg border border-border/70 bg-popover text-popover-foreground shadow-lg ring-1 ring-black/5 z-50 animate-in fade-in slide-in-from-top-1 duration-150"
          data-testid="search-results"
        >
          {results.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
              No matches for &ldquo;{q}&rdquo;
            </div>
          ) : (
            results.map((r) => (
              <button
                key={r.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  router.push(`/b/${r.boardId}/c/${r.id}`);
                  setOpen(false); setQ("");
                }}
                className="block w-full text-left px-3 py-2 transition-colors duration-100 hover:bg-accent border-b border-border/50 last:border-b-0"
                data-testid={`search-result-${r.id}`}
              >
                <div className="text-sm font-medium">{r.title}</div>
                <div className="text-xs text-muted-foreground">{r.boardTitle}</div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
