"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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

  return (
    <div className="relative">
      <Input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search cards…"
        className="h-8 w-56 text-sm"
        data-testid="search-box"
      />
      {open && results.length > 0 && (
        <div className="absolute right-0 top-9 w-80 max-h-80 overflow-y-auto rounded border bg-background shadow-md z-50"
             data-testid="search-results">
          {results.map((r) => (
            <button key={r.id}
              onMouseDown={(e) => {
                e.preventDefault();
                router.push(`/b/${r.boardId}/c/${r.id}`);
                setOpen(false); setQ("");
              }}
              className="block w-full text-left px-3 py-2 hover:bg-accent border-b last:border-b-0"
              data-testid={`search-result-${r.id}`}>
              <div className="text-sm font-medium">{r.title}</div>
              <div className="text-xs text-muted-foreground">{r.boardTitle}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
