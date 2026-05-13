"use client";
import { useMemo, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Mountain } from "lucide-react";
import { useBoardStore } from "@/stores/board-store";
import { useShallow } from "zustand/shallow";

// Horizontal strip of epic chips rendered above the kanban lists.
// Each chip is an epic-type card on this board; clicking scopes the
// board view to that epic's descendants via `?epic=<id>`. The "All"
// chip clears the filter. URL-backed so it round-trips through refresh
// and share links.

export function EpicStrip() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [, start] = useTransition();

  // Pull epic cards + their child counts from the board store. Wrapped
  // in useShallow because we're computing a derived list of objects.
  const epics = useBoardStore(
    useShallow((s) => {
      const childCount = new Map<string, number>();
      for (const c of s.cards) {
        if (!c.archived && c.parentCardId) {
          childCount.set(c.parentCardId, (childCount.get(c.parentCardId) ?? 0) + 1);
        }
      }
      return s.cards
        .filter((c) => c.type === "epic" && !c.archived)
        .map((c) => ({
          id: c.id,
          title: c.title,
          count: childCount.get(c.id) ?? 0,
        }));
    }),
  );

  const activeEpic = sp.get("epic") ?? "";

  const sorted = useMemo(
    () => [...epics].sort((a, b) => a.title.localeCompare(b.title)),
    [epics],
  );

  function setEpic(next: string) {
    const params = new URLSearchParams(sp.toString());
    if (next) params.set("epic", next);
    else params.delete("epic");
    const qs = params.toString();
    start(() => router.replace(qs ? `${pathname}?${qs}` : pathname));
  }

  if (sorted.length === 0) return null;

  return (
    <div
      data-testid="epic-strip"
      className="border-b border-hairline px-3 sm:px-4 md:px-6 py-2 bg-[color:var(--bg-1)] overflow-x-auto"
    >
      <div className="inline-flex items-center gap-1.5 min-w-full">
        <span className="mono-meta-sm text-fg-faint inline-flex items-center gap-1 shrink-0">
          <Mountain className="size-3" aria-hidden />
          EPIC BOARDS
        </span>
        <button
          type="button"
          data-testid="epic-strip-all"
          aria-pressed={activeEpic === ""}
          onClick={() => setEpic("")}
          className={[
            "shrink-0 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
            activeEpic === ""
              ? "border-fg/40 bg-fg/10 text-fg"
              : "border-hairline bg-transparent text-fg-muted hover:text-fg hover:bg-[rgb(255_255_255/0.06)]",
          ].join(" ")}
        >
          All
        </button>
        {sorted.map((e) => {
          const on = activeEpic === e.id;
          return (
            <button
              key={e.id}
              type="button"
              data-epic-id={e.id}
              aria-pressed={on}
              onClick={() => setEpic(e.id)}
              className={[
                "shrink-0 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                on
                  ? "border-violet-400/60 bg-violet-500/15 text-violet-100"
                  : "border-hairline bg-transparent text-fg-muted hover:text-fg hover:bg-[rgb(255_255_255/0.06)]",
              ].join(" ")}
            >
              <Mountain className="size-3 text-violet-300" aria-hidden />
              <span className="truncate max-w-[14rem]">{e.title}</span>
              {e.count > 0 && (
                <span className="mono-meta-sm tabular-nums text-fg-faint">
                  {e.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
