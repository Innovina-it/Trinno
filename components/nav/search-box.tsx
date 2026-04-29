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
        className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink/40"
      />
      <Input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search cards…"
        className="h-7 w-56 pl-8 text-xs"
        data-testid="search-box"
      />
      {showResults && (
        <div
          className="absolute right-0 top-9 w-80 max-h-80 overflow-y-auto border border-ink bg-paper text-ink z-50 animate-in fade-in slide-in-from-top-1 duration-150"
          data-testid="search-results"
        >
          <div className="border-b border-rule bg-paper-shadow px-3 py-1.5">
            <span className="mono-meta-sm text-ink/60">
              {results.length} match{results.length === 1 ? "" : "es"}
            </span>
          </div>
          {results.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <p className="serif-display text-lg text-ink/60 italic">
                Nothing on file.
              </p>
              <p className="mono-meta-sm mt-1 text-ink/40">
                No matches for &ldquo;{q}&rdquo;
              </p>
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
                className="block w-full text-left px-3 py-2.5 transition-colors duration-100 hover:bg-paper-shadow hover:text-signal border-b border-rule last:border-b-0"
                data-testid={`search-result-${r.id}`}
              >
                <div className="text-sm font-medium leading-tight">{r.title}</div>
                <div className="mono-meta-sm mt-0.5 text-ink/50">{r.boardTitle}</div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
