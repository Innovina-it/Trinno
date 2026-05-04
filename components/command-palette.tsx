"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Command,
  Star,
  Clock,
  FileSearch,
  PlusSquare,
  FolderPlus,
  Sun,
  LogOut,
  ArrowRight,
  ListChecks,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { search } from "@/actions/search";
import { logout } from "@/actions/auth";

export type PaletteFavorite = {
  boardId: string;
  boardTitle: string;
  workspaceId: string;
  workspaceName: string;
};
export type PaletteRecent = PaletteFavorite;

type PaletteItem = {
  id: string;
  section: "Recents" | "Favorites" | "Cards" | "Actions";
  label: string;
  sub?: string;
  icon: React.ReactNode;
  onSelect: () => void | Promise<void>;
};

type CardResult = Awaited<ReturnType<typeof search>>[number];

/**
 * Plan #16b-γ-D (#5) — global command palette.
 *
 * `⌘K` / `Ctrl+K` toggles the palette. Sections:
 *  - Recents (last 5 board views)
 *  - Favorites (the user's starred boards)
 *  - Cards (search-as-you-type via existing `search` action)
 *  - Actions (New board, New workspace, Toggle theme, Sign out)
 *
 * Filtering is a simple case-insensitive substring match plus a
 * weighted score (early match in label > later match > submatch).
 * Arrow keys move selection; Enter dispatches; Esc closes. The dialog
 * is mounted once in app/(app)/layout.tsx so every authed page can
 * trigger it.
 */
export function CommandPalette({
  workspaces,
  activeWorkspaceId,
  favorites,
  recents,
}: {
  workspaces: { id: string; name: string }[];
  activeWorkspaceId?: string;
  favorites: PaletteFavorite[];
  recents: PaletteRecent[];
}) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cardResults, setCardResults] = useState<CardResult[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // ⌘K / Ctrl+K open + Esc close.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Reset state on close.
  useEffect(() => {
    if (!open) {
      setQ("");
      setCardResults([]);
      setActive(0);
    }
  }, [open]);

  // Debounced card search.
  useEffect(() => {
    if (!q.trim()) {
      setCardResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await search(q);
        setCardResults(r);
      } catch {
        setCardResults([]);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  // Build the items each render based on q + sources.
  const items = useMemo<PaletteItem[]>(() => {
    const out: PaletteItem[] = [];
    const needle = q.toLowerCase().trim();

    // Recents
    for (const r of recents) {
      const label = r.boardTitle;
      if (needle && !label.toLowerCase().includes(needle)) continue;
      out.push({
        id: `recent:${r.boardId}`,
        section: "Recents",
        label,
        sub: r.workspaceName,
        icon: <Clock className="size-3.5 text-fg-muted" />,
        onSelect: () => {
          router.push(`/b/${r.boardId}`);
          setOpen(false);
        },
      });
    }

    // Favorites
    for (const f of favorites) {
      const label = f.boardTitle;
      if (needle && !label.toLowerCase().includes(needle)) continue;
      // Avoid double-listing if the same board is also a recent.
      if (out.some((x) => x.id === `recent:${f.boardId}`)) continue;
      out.push({
        id: `fav:${f.boardId}`,
        section: "Favorites",
        label,
        sub: f.workspaceName,
        icon: <Star className="size-3.5 text-amber-300" />,
        onSelect: () => {
          router.push(`/b/${f.boardId}`);
          setOpen(false);
        },
      });
    }

    // Cards (only when there's a query — server search requires non-empty)
    for (const c of cardResults) {
      out.push({
        id: `card:${c.id}`,
        section: "Cards",
        label: c.title,
        sub: c.boardTitle,
        icon: <FileSearch className="size-3.5 text-fg-muted" />,
        onSelect: () => {
          router.push(`/b/${c.boardId}/c/${c.id}`);
          setOpen(false);
        },
      });
    }

    // Actions — always shown but filtered by q if present.
    // Plan #workspace-routing — "Open my tasks" and "New board…" route
    // to the *active* workspace (resolved server-side from the URL),
    // falling back to the first workspace only when the active one is
    // unknown (e.g. /inbox or a personal-scope dashboard).
    const targetWsId = activeWorkspaceId ?? workspaces[0]?.id;
    const actions: PaletteItem[] = [
      {
        id: "act:open-my-tasks",
        section: "Actions",
        label: "Open my tasks",
        sub: "Workspace-wide kanban grouped by status",
        icon: <ListChecks className="size-3.5 text-fg-muted" />,
        onSelect: () => {
          if (targetWsId) router.push(`/w/${targetWsId}/all-tasks`);
          setOpen(false);
        },
      },
      {
        id: "act:new-board",
        section: "Actions",
        label: "New board…",
        sub: "Open the active workspace and create",
        icon: <PlusSquare className="size-3.5 text-fg-muted" />,
        onSelect: () => {
          if (targetWsId) router.push(`/w/${targetWsId}?new-board=1`);
          setOpen(false);
        },
      },
      {
        id: "act:new-workspace",
        section: "Actions",
        label: "New workspace…",
        sub: "Open the home page",
        icon: <FolderPlus className="size-3.5 text-fg-muted" />,
        onSelect: () => {
          router.push("/?new-workspace=1");
          setOpen(false);
        },
      },
      {
        id: "act:toggle-theme",
        section: "Actions",
        label: "Toggle theme",
        sub: theme === "dark" ? "Dark → Light" : "Light → Dark",
        icon: <Sun className="size-3.5 text-fg-muted" />,
        onSelect: () => {
          setTheme(theme === "dark" ? "light" : "dark");
        },
      },
      {
        id: "act:logout",
        section: "Actions",
        label: "Sign out",
        sub: "End the current session",
        icon: <LogOut className="size-3.5 text-fg-muted" />,
        onSelect: async () => {
          setOpen(false);
          await logout();
        },
      },
    ];
    for (const a of actions) {
      if (needle && !a.label.toLowerCase().includes(needle)) continue;
      out.push(a);
    }

    return out;
  }, [q, recents, favorites, cardResults, workspaces, activeWorkspaceId, theme, setTheme, router]);

  // Group items per section for rendering.
  const grouped = useMemo(() => {
    const g = new Map<PaletteItem["section"], PaletteItem[]>();
    for (const it of items) {
      if (!g.has(it.section)) g.set(it.section, []);
      g.get(it.section)!.push(it);
    }
    return Array.from(g.entries());
  }, [items]);

  // Reset active index when items shrink/grow.
  useEffect(() => {
    if (active >= items.length) setActive(0);
  }, [items.length, active]);

  function onListKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const it = items[active];
      if (it) it.onSelect();
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="sm:max-w-lg p-0 gap-0"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <div className="flex items-center gap-2 border-b border-hairline px-4 py-3">
          <Command className="size-4 text-fg-muted" />
          <input
            ref={inputRef}
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onListKeyDown}
            placeholder="Type a command or search…"
            data-testid="command-palette-input"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-fg-faint placeholder:italic placeholder:font-serif"
          />
          <span className="mono-meta-sm text-fg-faint">ESC</span>
        </div>
        <div
          className="max-h-[60vh] overflow-y-auto p-1"
          data-testid="command-palette-list"
        >
          {items.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-fg-faint italic">
              No matches.
            </div>
          )}
          {grouped.map(([section, sectionItems]) => (
            <div key={section} className="mb-1">
              <div className="px-2 pt-2 pb-1 mono-meta-sm text-fg-faint tracking-wider">
                {section.toUpperCase()}
              </div>
              <ul>
                {sectionItems.map((it) => {
                  const idx = items.findIndex((x) => x.id === it.id);
                  const isActive = idx === active;
                  return (
                    <li key={it.id}>
                      <button
                        type="button"
                        onMouseEnter={() => setActive(idx)}
                        onClick={() => it.onSelect()}
                        data-testid={`palette-item-${it.id}`}
                        className={`flex w-full items-center gap-2 px-2 py-2 rounded-lg text-left transition-colors ${
                          isActive
                            ? "bg-[color:var(--surface-hi)] text-fg"
                            : "text-fg-muted hover:bg-[color:var(--surface)]"
                        }`}
                      >
                        {it.icon}
                        <span className="flex-1 truncate text-sm">
                          {it.label}
                        </span>
                        {it.sub && (
                          <span className="mono-meta-sm text-fg-faint truncate max-w-[12rem]">
                            {it.sub}
                          </span>
                        )}
                        {isActive && (
                          <ArrowRight className="size-3 text-fg-faint" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
